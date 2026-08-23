from django.db.models import Q
from rest_framework import permissions, viewsets

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

        qs = Project.objects.filter(organization=user.organization).select_related("owner").prefetch_related("members")

        # Members can only view projects they are owner or member of
        if not user.is_privileged:
            qs = qs.filter(Q(owner=user) | Q(members=user)).distinct()

        return qs

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, owner=self.request.user)
