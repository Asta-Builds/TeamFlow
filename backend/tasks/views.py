from rest_framework import decorators, permissions, response, status, viewsets

from teamflow.permissions import IsOwnerOrPrivileged
from notifications.models import Notification
from .models import Comment, Task, TaskActivity
from .serializers import CommentSerializer, TaskActivitySerializer, TaskSerializer


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrPrivileged]
    filterset_fields = ["project", "status", "priority", "task_type", "assignee"]
    search_fields = ["title", "description"]
    ordering_fields = ["order", "created_at", "priority", "status", "due_date"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Task.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Task.objects.none()

        qs = Task.objects.filter(organization=user.organization).select_related(
            "assignee", "created_by", "project"
        ).prefetch_related("comments__author", "activities__actor")

        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        task = serializer.save(created_by=user, organization=user.organization)
        # Log activity
        TaskActivity.objects.create(
            task=task,
            actor=user,
            action="created",
            details={"title": task.title, "status": task.status}
        )
        # Notify assignee if assigned
        if task.assignee and task.assignee != user:
            Notification.objects.create(
                recipient=task.assignee,
                actor=user,
                title=f"Ticket assigned: {task.title}",
                message=f"{user.name or user.email} assigned you to ticket '{task.title}' in {task.project.name}.",
                link=f"/projects/{task.project_id}",
                organization=user.organization,
            )

    def perform_update(self, serializer):
        user = self.request.user
        old_task = self.get_object()
        old_status = old_task.status
        old_assignee = old_task.assignee

        task = serializer.save()

        # Track status change
        if task.status != old_status:
            TaskActivity.objects.create(
                task=task,
                actor=user,
                action="status_changed",
                details={"from": old_status, "to": task.status}
            )
            # Notification logic
            if task.status == Task.Status.QA:
                # Notify QA engineers in organization
                from accounts.models import User
                qa_users = User.objects.filter(organization=user.organization, role=User.Role.QA)
                for q in qa_users:
                    Notification.objects.create(
                        recipient=q,
                        actor=user,
                        title=f"Ticket ready for QA: {task.title}",
                        message=f"Ticket '{task.title}' was moved to QA for review.",
                        link=f"/projects/{task.project_id}",
                        organization=user.organization,
                    )
            elif task.status == Task.Status.DONE:
                if task.created_by and task.created_by != user:
                    Notification.objects.create(
                        recipient=task.created_by,
                        actor=user,
                        title=f"Ticket completed: {task.title}",
                        message=f"Ticket '{task.title}' was marked as Done.",
                        link=f"/projects/{task.project_id}",
                        organization=user.organization,
                    )

        # Track assignee change
        if task.assignee != old_assignee:
            TaskActivity.objects.create(
                task=task,
                actor=user,
                action="assigned",
                details={"assignee": task.assignee.email if task.assignee else "None"}
            )
            if task.assignee and task.assignee != user:
                Notification.objects.create(
                    recipient=task.assignee,
                    actor=user,
                    title=f"Ticket assigned: {task.title}",
                    message=f"You were assigned to ticket '{task.title}'.",
                    link=f"/projects/{task.project_id}",
                    organization=user.organization,
                )

    @decorators.action(detail=True, methods=["post"])
    def comments(self, request, pk=None):
        """POST /api/tasks/{id}/comments/ — add a comment/status update."""
        task = self.get_object()
        serializer = CommentSerializer(data={**request.data, "task": task.id}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(author=request.user, task=task)

        # Log activity
        TaskActivity.objects.create(
            task=task,
            actor=request.user,
            action="commented",
            details={"comment_preview": comment.body[:100]}
        )

        # If comment contains @agent tags (e.g. @tech_lead, @backend, @qa), generate autonomous AI Agent response
        agent_replies = []
        if "@" in comment.body:
            from agents.agent_prompter import process_ceo_prompt
            agent_replies = process_ceo_prompt(task, comment.body, request.user)

        # Notify assignee & creator
        recipients = {task.assignee, task.created_by} - {request.user, None}
        for recipient in recipients:
            Notification.objects.create(
                recipient=recipient,
                actor=request.user,
                title=f"New comment on: {task.title}",
                message=f"{request.user.name or request.user.email} commented: {comment.body[:80]}",
                link=f"/projects/{task.project_id}",
                organization=request.user.organization,
            )

        return response.Response({
            **serializer.data,
            "agent_replies": agent_replies
        }, status=201)

    @decorators.action(detail=True, methods=["post"])
    def prompt_agent(self, request, pk=None):
        """
        POST /api/tasks/{id}/prompt_agent/
        Direct CEO prompt endpoint to tag and instruct specific AI agents.
        Body: { "prompt": "@tech_lead review the schema", "agent_tag": "tech_lead" }
        """
        task = self.get_object()
        prompt_text = request.data.get("prompt", "").strip()
        agent_tag = request.data.get("agent_tag", "").strip() or None

        if not prompt_text:
            return response.Response({"detail": "Prompt text is required."}, status=400)

        # First, record CEO's prompt as a comment
        ceo_comment = Comment.objects.create(
            task=task,
            author=request.user,
            body=prompt_text
        )

        TaskActivity.objects.create(
            task=task,
            actor=request.user,
            action="prompted_agent",
            details={"prompt": prompt_text[:100], "agent_tag": agent_tag or "auto"}
        )

        # Generate agent response(s)
        from agents.agent_prompter import process_ceo_prompt
        agent_replies = process_ceo_prompt(task, prompt_text, request.user, specific_tag=agent_tag)

        return response.Response({
            "task_id": task.id,
            "ceo_comment": CommentSerializer(ceo_comment, context={"request": request}).data,
            "agent_replies": agent_replies,
        })

    @decorators.action(detail=True, methods=["post"])
    def qa_validate(self, request, pk=None):
        """QA Engineer / Tech Lead validates a ticket in QA -> transitions to DONE."""
        task = self.get_object()
        if not request.user.can_validate_qa:
            return response.Response({"detail": "Only QA Engineer, Tech Lead or CEO can validate QA."}, status=403)

        task.status = Task.Status.DONE
        task.qa_rejected = False
        task.qa_rejection_reason = ""
        task.save()

        TaskActivity.objects.create(
            task=task,
            actor=request.user,
            action="qa_validated",
            details={"note": "QA passed and ticket closed"}
        )

        if task.assignee and task.assignee != request.user:
            Notification.objects.create(
                recipient=task.assignee,
                actor=request.user,
                title=f"QA Approved: {task.title}",
                message=f"QA verified ticket '{task.title}'. Ticket is now Done.",
                link=f"/projects/{task.project_id}",
                organization=request.user.organization,
            )

        return response.Response(TaskSerializer(task).data)

    @decorators.action(detail=True, methods=["post"])
    def qa_reject(self, request, pk=None):
        """QA Engineer / Tech Lead rejects a ticket -> transitions back to IN_PROGRESS with mandatory comment."""
        task = self.get_object()
        if not request.user.can_validate_qa:
            return response.Response({"detail": "Only QA Engineer, Tech Lead or CEO can reject QA."}, status=403)

        reason = request.data.get("reason", "").strip()
        if not reason:
            return response.Response({"reason": ["A rejection explanation is mandatory."]}, status=400)

        task.status = Task.Status.IN_PROGRESS
        task.qa_rejected = True
        task.qa_rejection_reason = reason
        task.save()

        # Add comment with rejection reason
        Comment.objects.create(
            task=task,
            author=request.user,
            body=f"❌ QA Rejected: {reason}"
        )

        TaskActivity.objects.create(
            task=task,
            actor=request.user,
            action="qa_rejected",
            details={"reason": reason}
        )

        if task.assignee and task.assignee != request.user:
            Notification.objects.create(
                recipient=task.assignee,
                actor=request.user,
                title=f"QA Rejected: {task.title}",
                message=f"Ticket '{task.title}' failed QA review: {reason}",
                link=f"/projects/{task.project_id}",
                organization=request.user.organization,
            )

        return response.Response(TaskSerializer(task).data)

    @decorators.action(detail=False, methods=["get"])
    def my_tasks(self, request):
        """GET /api/tasks/my_tasks/ — transverse view of tasks assigned to current user."""
        qs = self.get_queryset().filter(assignee=request.user)
        serializer = self.get_serializer(qs, many=True)
        return response.Response(serializer.data)

    @decorators.action(detail=False, methods=["get"])
    def feed(self, request):
        """GET /api/tasks/feed/ — real-time activity feed for dashboard."""
        user = request.user
        activities = TaskActivity.objects.filter(
            task__organization=user.organization
        ).select_related("actor", "task", "task__project").order_by("-created_at")[:40]

        project_id = request.query_params.get("project")
        if project_id:
            activities = activities.filter(task__project_id=project_id)

        action_filter = request.query_params.get("action")
        if action_filter:
            activities = activities.filter(action=action_filter)

        data = [
            {
                "id": a.id,
                "task_id": a.task_id,
                "task_title": a.task.title,
                "project_id": a.task.project_id,
                "project_name": a.task.project.name,
                "actor_name": a.actor.name or a.actor.email if a.actor else "System",
                "actor_role": a.actor.role if a.actor else "system",
                "action": a.action,
                "details": a.details,
                "created_at": a.created_at.isoformat(),
            }
            for a in activities
        ]
        return response.Response(data)


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrPrivileged]
    filterset_fields = ["task"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Comment.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Comment.objects.none()

        return Comment.objects.filter(task__organization=user.organization).select_related(
            "author", "task"
        )

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
