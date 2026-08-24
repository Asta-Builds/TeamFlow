import csv
import json
from django.db.models import Q
from django.http import HttpResponse
from rest_framework import decorators, permissions, response, viewsets

from teamflow.permissions import IsOwnerOrPrivileged
from .models import Project
from .serializers import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """
    Project ViewSet. Limited to projects inside the user's organization.
    """
    serializer_class = ProjectSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrPrivileged]
    filterset_fields = ["status", "owner"]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "name", "status"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Project.objects.none()

        qs = Project.objects.filter(organization=user.organization).select_related("owner").prefetch_related("members", "tasks")

        # Members can only view projects they are owner or member of unless privileged (CEO, Tech Lead, Admin)
        if not user.is_privileged:
            qs = qs.filter(Q(owner=user) | Q(members=user)).distinct()

        return qs

    def perform_create(self, serializer):
        if not self.request.user.can_create_project:
            raise permissions.exceptions.PermissionDenied("Only Tech Lead, CEO or Admin can create projects.")
        serializer.save(organization=self.request.user.organization, owner=self.request.user)

    def perform_destroy(self, instance):
        if not self.request.user.can_create_project:
            raise permissions.exceptions.PermissionDenied("Only Tech Lead, CEO or Admin can delete or archive projects.")
        instance.delete()

    @decorators.action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """Export project and its tickets as CSV or JSON."""
        project = self.get_object()
        fmt = request.query_params.get("format", "json").lower()
        tasks = project.tasks.all().select_related("assignee", "created_by")

        if fmt == "csv":
            response_http = HttpResponse(content_type="text/csv")
            response_http["Content-Disposition"] = f'attachment; filename="{project.name}_tasks.csv"'
            writer = csv.writer(response_http)
            writer.writerow(["ID", "Title", "Type", "Status", "Priority", "Assignee", "Created By", "Due Date", "Created At"])
            for t in tasks:
                writer.writerow([
                    t.id,
                    t.title,
                    t.task_type,
                    t.status,
                    t.priority,
                    t.assignee.email if t.assignee else "",
                    t.created_by.email if t.created_by else "",
                    t.due_date or "",
                    t.created_at.isoformat(),
                ])
            return response_http

        data = {
            "project": {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "status": project.status,
            },
            "tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "description": t.description,
                    "type": t.task_type,
                    "status": t.status,
                    "priority": t.priority,
                    "assignee": t.assignee.email if t.assignee else None,
                    "created_at": t.created_at.isoformat(),
                }
                for t in tasks
            ]
        }
        return response.Response(data)

    @decorators.action(detail=True, methods=["post"])
    def pm_generate_tasks(self, request, pk=None):
        """
        AI Product Manager endpoint: Decomposes a user/CEO plan into
        concrete engineering tickets, assigns them to specialist AI agents,
        and generates inter-agent collaboration comments.
        """
        project = self.get_object()
        data = request.data
        if isinstance(data, str):
            import json
            try:
                data = json.loads(data)
            except Exception:
                pass

        if not isinstance(data, dict):
            return response.Response({"error": "Invalid request body. Expected a JSON object."}, status=400)

        plan_text = data.get("plan", "").strip()
        if not plan_text:
            return response.Response({"error": "A plan or feature prompt is required."}, status=400)

        from agents.pm_service import decompose_plan_and_create_tasks
        from tasks.serializers import TaskSerializer

        res = decompose_plan_and_create_tasks(project, plan_text, request.user)
        res["tasks_data"] = TaskSerializer(res["tasks"], many=True).data
        res.pop("tasks", None)
        return response.Response(res)
