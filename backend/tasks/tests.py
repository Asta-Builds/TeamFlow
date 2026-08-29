from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from projects.models import Project
from tasks.models import Task, TaskActivity
from organizations.models import Organization

User = get_user_model()


class APIFlowTests(APITestCase):
    """End-to-end happy path across auth, organizations, projects, tasks and comments."""

    def _auth(self, email, password):
        res = self.client.post(
            "/api/auth/login/", {"email": email, "password": password}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_register_login_and_me(self):
        res = self.client.post(
            "/api/auth/register/",
            {
                "email": "dev@teamflow.dev",
                "name": "Dev User",
                "password": "sup3r-secret-pw",
                "organization_name": "Dev Org"
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)

        self._auth("dev@teamflow.dev", "sup3r-secret-pw")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["email"], "dev@teamflow.dev")
        self.assertEqual(me.data["organization_name"], "Dev Org")

    def test_project_task_and_comment_flow(self):
        org = Organization.objects.create(name="TeamFlow Corp")
        lead = User.objects.create_user(
            email="lead@teamflow.dev", password="pw-lead-12345", role=User.Role.ADMIN, organization=org
        )
        self._auth("lead@teamflow.dev", "pw-lead-12345")

        # Create a Project
        res = self.client.post(
            "/api/projects/", {"name": "TeamFlow MVP", "description": "core"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        project_id = res.data["id"]
        self.assertEqual(res.data["owner"], lead.id)

        # Create a task in it
        res = self.client.post(
            "/api/tasks/",
            {"project": project_id, "title": "Ship auth", "priority": "high"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        task_id = res.data["id"]
        self.assertEqual(res.data["created_by"], lead.id)

        # Comment on the task via the nested action
        res = self.client.post(
            f"/api/tasks/{task_id}/comments/", {"body": "On it."}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)

        # Task detail carries the comment thread
        res = self.client.get(f"/api/tasks/{task_id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["comments"]), 1)
        self.assertEqual(res.data["comments"][0]["body"], "On it.")

        # Filter tasks by project
        res = self.client.get(f"/api/tasks/?project={project_id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 1)

    def test_unauthenticated_is_rejected(self):
        res = self.client.get("/api/projects/")
        self.assertEqual(res.status_code, 401)

    def test_member_cannot_edit_another_users_project(self):
        org = Organization.objects.create(name="TeamFlow Corp")
        owner = User.objects.create_user(
            email="owner@teamflow.dev", password="pw-owner-1234", role=User.Role.MEMBER, organization=org
        )
        project = Project.objects.create(name="Owned", owner=owner, organization=org)

        User.objects.create_user(
            email="intruder@teamflow.dev", password="pw-intru-1234", role=User.Role.MEMBER, organization=org
        )
        self._auth("intruder@teamflow.dev", "pw-intru-1234")
        res = self.client.patch(
            f"/api/projects/{project.id}/", {"name": "hijacked"}, format="json"
        )
        # Not owner, not member of project, not admin → object-level write denied
        self.assertIn(res.status_code, (403, 404))

    def test_tenant_isolation(self):
        # Create Org A
        org_a = Organization.objects.create(name="Org A")
        user_a = User.objects.create_user(
            email="admin_a@teamflow.dev", password="password123", role=User.Role.ADMIN, organization=org_a
        )
        project_a = Project.objects.create(name="Project A", organization=org_a)

        # Create Org B
        org_b = Organization.objects.create(name="Org B")
        user_b = User.objects.create_user(
            email="admin_b@teamflow.dev", password="password123", role=User.Role.ADMIN, organization=org_b
        )
        project_b = Project.objects.create(name="Project B", organization=org_b)

        # Auth as user A, should only see Org A's projects
        self._auth("admin_a@teamflow.dev", "password123")
        res = self.client.get("/api/projects/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["results"][0]["id"], project_a.id)

        # Try to retrieve Org B's project directly, should return 404
        res = self.client.get(f"/api/projects/{project_b.id}/")
        self.assertEqual(res.status_code, 404)

    def test_cross_tenant_task_assignment_is_rejected(self):
        org_a = Organization.objects.create(name="Org A")
        admin_a = User.objects.create_user(
            email="admin-a@example.com",
            password="password123",
            role=User.Role.ADMIN,
            organization=org_a,
        )
        project_a = Project.objects.create(name="Project A", organization=org_a, owner=admin_a)
        org_b = Organization.objects.create(name="Org B")
        user_b = User.objects.create_user(
            email="user-b@example.com",
            password="password123",
            organization=org_b,
        )
        self.client.force_authenticate(user=admin_a)
        response = self.client.post(
            "/api/tasks/",
            {"project": project_a.id, "title": "Invalid assignment", "assignee": user_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("assignee", response.data)

    def test_filtered_activity_feed_filters_before_limit(self):
        org = Organization.objects.create(name="Feed Org")
        admin = User.objects.create_user(
            email="feed-admin@example.com",
            password="password123",
            role=User.Role.ADMIN,
            organization=org,
        )
        project = Project.objects.create(name="Feed Project", organization=org, owner=admin)
        task = Task.objects.create(
            project=project,
            organization=org,
            title="Feed task",
            created_by=admin,
        )
        TaskActivity.objects.create(task=task, actor=admin, action="created")
        TaskActivity.objects.create(task=task, actor=admin, action="commented")
        self.client.force_authenticate(user=admin)
        response = self.client.get(f"/api/tasks/feed/?project={project.id}&action=commented")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["action"], "commented")
