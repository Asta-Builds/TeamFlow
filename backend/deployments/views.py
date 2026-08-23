from rest_framework import decorators, permissions, response, viewsets

from teamflow.permissions import IsPrivilegedOrReadOnly
from .models import Deployment
from .serializers import DeploymentSerializer


class DeploymentViewSet(viewsets.ModelViewSet):
    """Deployment history. Triggering a deploy is a privileged (Admin) action."""

    serializer_class = DeploymentSerializer
    permission_classes = [permissions.IsAuthenticated, IsPrivilegedOrReadOnly]
    filterset_fields = ["project", "environment", "status"]
    ordering_fields = ["started_at", "status"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Deployment.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Deployment.objects.none()
        return Deployment.objects.filter(organization=user.organization).select_related("project", "triggered_by")

    def perform_create(self, serializer):
        serializer.save(triggered_by=self.request.user, organization=self.request.user.organization)

    @decorators.action(detail=True, methods=["get"])
    def status(self, request, pk=None):
        """GET /api/deployments/{id}/status/ — lightweight status poll."""
        deployment = self.get_object()
        return response.Response(
            {
                "id": deployment.id,
                "status": deployment.status,
                "environment": deployment.environment,
                "finished_at": deployment.finished_at,
            }
        )
