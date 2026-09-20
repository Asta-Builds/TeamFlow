"""Tests for the release gate: approvals pin a commit, and only humans who own the workspace decide."""

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from organizations.models import Membership, Organization
from projects.models import Project
from tasks.models import Comment, Task

from agents.approvals import ApprovalConflictError, approve, can_decide, reject, request_release_approval
from agents.models import AgentEvent, AgentExecutionTrace, ApprovalRequest
from agents.nodes.devops_agent import devops_agent_node
from agents.release import ReleaseResult
from agents.users import get_or_create_agent_user

HEAD = "a" * 40
OTHER_HEAD = "b" * 40


def merged_result(**overrides):
    values = {
        "merged": True,
        "merge_mode": "github_api",
        "merged_sha": "c" * 40,
        "detail": "Merged PR #1 into main at ccccccc through GitHub.",
        "pr_url": "https://github.com/owner/repo/pull/1",
        "deployment": {"ok": True, "deployment_id": 9},
        "deployment_status": "in_progress",
        "deployment_detail": "Deployment #9 was accepted by the provider.",
        "ticket_moved_to_done": True,
    }
    values.update(overrides)
    return ReleaseResult(**values)


class ApprovalBaseTestCase(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Approval Org")
        self.other_org = Organization.objects.create(name="Other Org")

        self.ceo = self._person("ceo@example.com", "Dana Ceo", "ceo", self.org, Membership.Role.OWNER)
        self.admin = self._person("admin@example.com", "Alex Admin", "admin", self.org, Membership.Role.ADMIN)
        self.member = self._person("member@example.com", "Sam Member", "member", self.org, Membership.Role.MEMBER)
        self.outsider = self._person("outsider@example.com", "Otto Outsider", "ceo", self.other_org, Membership.Role.OWNER)

        self.project = Project.objects.create(name="Approval Project", organization=self.org, owner=self.ceo)
        self.task = Task.objects.create(
            project=self.project,
            title="Ship the health endpoint",
            description="Add /health",
            status=Task.Status.QA,
            task_type=Task.Type.FEATURE,
            priority=Task.Priority.HIGH,
            created_by=self.ceo,
            organization=self.org,
        )
        self.trace = AgentExecutionTrace.objects.create(
            task=self.task,
            session_id=f"ticket-{self.task.id}-session",
            status=AgentExecutionTrace.Status.RUNNING,
        )
        self.client = APIClient()

    def _person(self, email, name, role, organization, membership_role):
        user = User.objects.create_user(
            email=email,
            name=name,
            role=role,
            organization=organization,
            password="testpassword123",
        )
        Membership.objects.create(
            user=user,
            organization=organization,
            role=membership_role,
            status=Membership.Status.ACTIVE,
        )
        return user

    def _state(self, **overrides):
        state = {
            "ticket_id": self.task.id,
            "project_id": self.project.id,
            "title": self.task.title,
            "branch_name": "feat/ticket-1-health",
            "github_repo": "owner/repo",
            "pr_url": "https://github.com/owner/repo/pull/1",
            "langfuse_session_id": self.trace.session_id,
            "history": [],
            "total_tokens": 0,
            "total_cost_usd": 0.0,
        }
        state.update(overrides)
        return state


class ReleaseGateTestCase(ApprovalBaseTestCase):
    @override_settings(AGENT_REQUIRE_RELEASE_APPROVAL=True)
    @patch("agents.nodes.devops_agent.perform_release")
    @patch("agents.approvals.current_branch_head", return_value=HEAD)
    def test_graph_gate_creates_approval_and_releases_nothing(self, _head, mock_release):
        result = devops_agent_node(self._state())

        approval = ApprovalRequest.objects.get(task=self.task)
        self.assertEqual(approval.status, ApprovalRequest.Status.PENDING)
        self.assertEqual(approval.head_sha, HEAD)
        self.assertEqual(approval.engine, "graph")
        self.assertEqual(approval.trace_id, self.trace.id)
        mock_release.assert_not_called()

        self.task.refresh_from_db()
        self.assertEqual(self.task.status, Task.Status.QA)
        self.assertEqual(result.get("approval_id"), approval.id)

        event = AgentEvent.objects.filter(task=self.task).last()
        self.assertTrue(event.metadata.get("requires_confirmation"))
        self.assertEqual(event.metadata.get("approval_id"), approval.id)
        self.assertEqual(event.metadata.get("tool_name"), "release")
        self.assertEqual(event.metadata.get("danger_level"), "high")
        self.assertEqual(event.metadata["tool_args"]["head_sha"], HEAD)

        comment = Comment.objects.filter(task=self.task).last()
        self.assertIn("waiting for approval", comment.body)
        self.assertIn(HEAD[:7], comment.body)

    @override_settings(AGENT_REQUIRE_RELEASE_APPROVAL=False)
    @patch("agents.nodes.devops_agent.perform_release")
    @patch("agents.nodes.devops_agent.current_branch_head", return_value=HEAD)
    def test_gate_off_releases_immediately_without_approval(self, _head, mock_release):
        mock_release.return_value = merged_result()

        devops_agent_node(self._state())

        self.assertFalse(ApprovalRequest.objects.filter(task=self.task).exists())
        mock_release.assert_called_once()
        self.assertEqual(mock_release.call_args.kwargs["expected_head_sha"], HEAD)

    @patch("agents.approvals.current_branch_head", return_value=HEAD)
    def test_a_new_approval_supersedes_the_previous_pending_one(self, _head):
        first = request_release_approval(self.task, trace=self.trace, engine="graph", branch="feat/x")
        second = request_release_approval(self.task, trace=self.trace, engine="graph", branch="feat/x")

        first.refresh_from_db()
        self.assertEqual(first.status, ApprovalRequest.Status.SUPERSEDED)
        self.assertEqual(second.status, ApprovalRequest.Status.PENDING)

    @patch("agents.approvals.current_branch_head", return_value=OTHER_HEAD)
    def test_the_pinned_sha_is_the_resolved_head(self, _head):
        approval = request_release_approval(self.task, trace=self.trace, engine="graph", branch="feat/x")
        self.assertEqual(approval.head_sha, OTHER_HEAD)


class ApprovalPermissionTestCase(ApprovalBaseTestCase):
    def test_only_workspace_owners_and_admins_may_decide(self):
        self.assertTrue(can_decide(self.ceo, self.org))
        self.assertTrue(can_decide(self.admin, self.org))
        self.assertFalse(can_decide(self.member, self.org))
        self.assertFalse(can_decide(self.outsider, self.org))

    def test_an_ai_agent_seat_may_never_decide(self):
        agent = get_or_create_agent_user("devops", self.org)
        Membership.objects.create(
            user=agent,
            organization=self.org,
            role=Membership.Role.ADMIN,
            status=Membership.Status.ACTIVE,
        )
        self.assertFalse(can_decide(agent, self.org))

    def test_a_demoted_admin_may_not_decide_even_with_a_stale_cached_role(self):
        """Membership is the source of truth, not the role cached on the user row."""
        Membership.objects.filter(user=self.admin, organization=self.org).update(role=Membership.Role.MEMBER)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, "admin")  # stale cache
        self.assertFalse(can_decide(self.admin, self.org))


class ApprovalEndpointTestCase(ApprovalBaseTestCase):
    def setUp(self):
        super().setUp()
        with patch("agents.approvals.current_branch_head", return_value=HEAD):
            self.approval = request_release_approval(
                self.task, trace=self.trace, engine="graph", branch="feat/x", repo="owner/repo"
            )

    def test_list_and_detail_are_scoped_to_the_organization(self):
        self.client.force_authenticate(user=self.member)
        listed = self.client.get(f"/api/agents/approvals/?task={self.task.id}")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row["id"] for row in listed.data], [self.approval.id])

        self.client.force_authenticate(user=self.outsider)
        self.assertEqual(self.client.get(f"/api/agents/approvals/{self.approval.id}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/agents/approvals/{self.approval.id}/approve/", {}).status_code, 404)

    @patch("agents.tasks.execute_release_approval")
    def test_ceo_and_admin_can_approve(self, _task):
        for user in (self.ceo, self.admin):
            approval = ApprovalRequest.objects.create(
                organization=self.org,
                task=self.task,
                kind=ApprovalRequest.Kind.RELEASE,
                status=ApprovalRequest.Status.PENDING,
                branch="feat/x",
                head_sha=HEAD,
                engine="graph",
            )
            self.client.force_authenticate(user=user)
            response = self.client.post(f"/api/agents/approvals/{approval.id}/approve/", {}, format="json")
            self.assertEqual(response.status_code, 202, response.data)
            approval.refresh_from_db()
            self.assertEqual(approval.status, ApprovalRequest.Status.APPROVED)
            self.assertEqual(approval.decided_by_id, user.id)

    def test_a_member_cannot_approve_or_reject(self):
        self.client.force_authenticate(user=self.member)
        self.assertEqual(
            self.client.post(f"/api/agents/approvals/{self.approval.id}/approve/", {}, format="json").status_code, 403
        )
        self.assertEqual(
            self.client.post(
                f"/api/agents/approvals/{self.approval.id}/reject/", {"reason": "no"}, format="json"
            ).status_code,
            403,
        )
        self.approval.refresh_from_db()
        self.assertEqual(self.approval.status, ApprovalRequest.Status.PENDING)

    @patch("agents.tasks.execute_release_approval")
    def test_approving_twice_conflicts(self, _task):
        self.client.force_authenticate(user=self.ceo)
        first = self.client.post(f"/api/agents/approvals/{self.approval.id}/approve/", {}, format="json")
        self.assertEqual(first.status_code, 202)
        second = self.client.post(f"/api/agents/approvals/{self.approval.id}/approve/", {}, format="json")
        self.assertEqual(second.status_code, 409)

    def test_rejecting_requires_a_reason_and_keeps_the_ticket_in_qa(self):
        self.client.force_authenticate(user=self.ceo)
        empty = self.client.post(f"/api/agents/approvals/{self.approval.id}/reject/", {"reason": "  "}, format="json")
        self.assertEqual(empty.status_code, 400)

        ok = self.client.post(
            f"/api/agents/approvals/{self.approval.id}/reject/",
            {"reason": "Needs a migration plan first"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.data)
        self.approval.refresh_from_db()
        self.assertEqual(self.approval.status, ApprovalRequest.Status.REJECTED)
        self.assertEqual(self.approval.decision_reason, "Needs a migration plan first")

        self.task.refresh_from_db()
        self.assertEqual(self.task.status, Task.Status.QA)
        comment = Comment.objects.filter(task=self.task).last()
        self.assertIn("Dana Ceo", comment.body)
        self.assertIn("Needs a migration plan first", comment.body)

    def test_deciding_a_superseded_approval_conflicts(self):
        self.approval.status = ApprovalRequest.Status.SUPERSEDED
        self.approval.save(update_fields=["status"])
        with self.assertRaises(ApprovalConflictError):
            approve(self.approval, self.ceo)
        with self.assertRaises(ApprovalConflictError):
            reject(self.approval, self.ceo, "too late")


class ReleaseExecutionTestCase(ApprovalBaseTestCase):
    def _approved(self):
        approval = ApprovalRequest.objects.create(
            organization=self.org,
            task=self.task,
            trace=self.trace,
            kind=ApprovalRequest.Kind.RELEASE,
            status=ApprovalRequest.Status.APPROVED,
            branch="feat/x",
            head_sha=HEAD,
            repo="owner/repo",
            pr_url="https://github.com/owner/repo/pull/1",
            engine="graph",
            decided_by=self.ceo,
        )
        return approval

    @patch("agents.tasks.perform_release")
    def test_a_merged_release_is_recorded_as_executed(self, mock_release):
        from agents.tasks import execute_release_approval

        mock_release.return_value = merged_result()
        approval = self._approved()

        execute_release_approval(approval.id)

        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.Status.EXECUTED)
        self.assertTrue(approval.result["merged"])
        self.assertEqual(mock_release.call_args.kwargs["expected_head_sha"], HEAD)

        self.trace.refresh_from_db()
        self.assertEqual(self.trace.status, AgentExecutionTrace.Status.COMPLETED)

    @patch("agents.tasks.perform_release")
    def test_a_refused_release_is_recorded_as_failed_with_its_reason(self, mock_release):
        from agents.tasks import execute_release_approval

        mock_release.return_value = merged_result(
            merged=False,
            merge_mode="none",
            merged_sha="",
            detail="The branch moved since it was approved (expected aaaaaaa, found bbbbbbb); nothing was merged.",
            deployment={},
            deployment_status="skipped",
            deployment_detail="Deployment was skipped because the branch was not merged.",
            ticket_moved_to_done=False,
        )
        approval = self._approved()

        execute_release_approval(approval.id)

        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.Status.FAILED)
        comment = Comment.objects.filter(task=self.task).last()
        self.assertIn("The branch moved since it was approved", comment.body)
        self.assertIn("left open for follow-up", comment.body)

    @patch("agents.tasks.perform_release", side_effect=RuntimeError("workspace exploded"))
    def test_an_unexpected_error_is_recorded_not_swallowed(self, _release):
        from agents.tasks import execute_release_approval

        approval = self._approved()
        execute_release_approval(approval.id)

        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.Status.FAILED)
        self.assertIn("workspace exploded", str(approval.result))

    @patch("agents.tasks.perform_release")
    def test_an_approval_that_is_not_approved_does_nothing(self, mock_release):
        from agents.tasks import execute_release_approval

        approval = self._approved()
        approval.status = ApprovalRequest.Status.REJECTED
        approval.save(update_fields=["status"])

        execute_release_approval(approval.id)

        mock_release.assert_not_called()
