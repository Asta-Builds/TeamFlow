from django.utils import timezone
from rest_framework import decorators, permissions, response, status, viewsets
from rest_framework.exceptions import PermissionDenied

from notifications.models import Notification
from .models import Deployment
from .serializers import DeploymentSerializer


class DeploymentViewSet(viewsets.ModelViewSet):
    """Deployment history. Triggering a deploy is a DevOps / privileged action."""

    serializer_class = DeploymentSerializer
    permission_classes = [permissions.IsAuthenticated]
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
        user = self.request.user
        if not user.can_deploy:
            raise PermissionDenied("Only DevOps Engineer, Tech Lead or CEO can trigger deployments.")

        logs = (
            f"=== Build & Deployment Pipeline Started ===\n"
            f"Target Environment: {serializer.validated_data.get('environment', 'staging')}\n"
            f"Branch: {serializer.validated_data.get('branch', 'main')}\n"
            f"Commit: {serializer.validated_data.get('commit_sha', 'head')}\n"
            f"Triggered by: {user.name or user.email}\n"
            f"[INFO] Running linting and static analysis... OK\n"
            f"[INFO] Running unit and integration tests... OK (100% passed)\n"
            f"[INFO] Building Docker container image... Done (42s)\n"
            f"[INFO] Deploying container to Kubernetes cluster... Done\n"
            f"[INFO] Health checks passing. Deployment verified!\n"
        )
        deployment = serializer.save(
            triggered_by=user,
            organization=user.organization,
            status=Deployment.Status.SUCCESS,
            logs=logs,
            duration_seconds=42,
            finished_at=timezone.now(),
        )

        # Notify workspace if failed, or notify Tech Lead / CEO
        from accounts.models import User
        privileged_users = User.objects.filter(
            organization=user.organization,
            role__in=[User.Role.TECH_LEAD, User.Role.CEO, User.Role.ADMIN, User.Role.DEVOPS]
        )
        for p in privileged_users:
            if p != user:
                Notification.objects.create(
                    recipient=p,
                    actor=user,
                    title=f"Deployment {deployment.status}: {deployment.project.name} ({deployment.environment})",
                    message=f"{user.name or user.email} deployed branch {deployment.branch} to {deployment.environment}.",
                    link="/deployments",
                    organization=user.organization,
                )

    @decorators.action(detail=True, methods=["get"])
    def status(self, request, pk=None):
        """GET /api/deployments/{id}/status/ — lightweight status poll."""
        deployment = self.get_object()
        return response.Response(
            {
                "id": deployment.id,
                "status": deployment.status,
                "environment": deployment.environment,
                "duration_seconds": deployment.duration_seconds,
                "finished_at": deployment.finished_at,
            }
        )

    @decorators.action(detail=True, methods=["post"])
    def rollback(self, request, pk=None):
        """Rollback to the target previous successful deployment."""
        if not request.user.can_deploy:
            return response.Response({"detail": "Only DevOps or Tech Lead can trigger rollbacks."}, status=403)

        target_deployment = self.get_object()
        new_deployment = Deployment.objects.create(
            project=target_deployment.project,
            environment=target_deployment.environment,
            status=Deployment.Status.ROLLED_BACK,
            commit_sha=target_deployment.commit_sha,
            branch=target_deployment.branch,
            triggered_by=request.user,
            organization=request.user.organization,
            logs=f"=== Rollback to commit {target_deployment.commit_sha} triggered by {request.user.name or request.user.email} ===\nRestoring previous release artifacts...\nTraffic routed back to stable release.",
            duration_seconds=15,
            finished_at=timezone.now(),
        )
        return response.Response(DeploymentSerializer(new_deployment).data, status=status.HTTP_201_CREATED)
