from rest_framework import decorators, permissions, response, viewsets

from teamflow.permissions import IsOwnerOrPrivileged
from .models import Comment, Task
from .serializers import CommentSerializer, TaskSerializer


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrPrivileged]
    filterset_fields = ["project", "status", "priority", "assignee"]
    search_fields = ["title", "description"]
    ordering_fields = ["order", "created_at", "priority", "status"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Task.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Task.objects.none()

        qs = Task.objects.filter(organization=user.organization).select_related(
            "assignee", "created_by", "project"
        ).prefetch_related("comments__author")

        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, organization=self.request.user.organization)

    @decorators.action(detail=True, methods=["post"])
    def comments(self, request, pk=None):
        """POST /api/tasks/{id}/comments/ — add a comment/status update."""
        task = self.get_object()
        serializer = CommentSerializer(data={**request.data, "task": task.id}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(author=request.user, task=task)
        return response.Response(serializer.data, status=201)


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
