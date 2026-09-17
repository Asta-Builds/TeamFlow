import json
import logging

from django.shortcuts import get_object_or_404
from rest_framework import decorators, permissions, response, status, viewsets
from rest_framework.exceptions import APIException, PermissionDenied

from notifications.models import Notification
from .models import Deployment
from .providers import SIGNATURE_HEADER, DeploymentProviderNotConfigured, verify_signature
from .serializers import DeploymentSerializer
from .services import apply_provider_callback, start_deployment

logger = logging.getLogger(__name__)


class DeploymentProviderUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "deployment_provider_unavailable"
    default_detail = "No deployment provider is configured for this environment."


def _notify_team(actor, deployment, title, message):
    from django.db.models import Q

    from accounts.models import User
    from organizations.membership import workspace_people
    from organizations.models import Membership

    recipients = (
        workspace_people(actor.organization)
        .filter(
            Q(memberships__organization=actor.organization, memberships__role__in=[Membership.Role.OWNER, Membership.Role.ADMIN])
            | Q(role__in=[User.Role.TECH_LEAD, User.Role.DEVOPS], organization=actor.organization)
            & ~Q(agent_key="")
        )
        .exclude(pk=actor.pk)
        .distinct()
    )
    for recipient in recipients:
        Notification.objects.create(
            recipient=recipient,
            actor=actor,
            title=title,
            message=message,
            link="/deployments",
            organization=actor.organization,
        )


class DeploymentViewSet(viewsets.ModelViewSet):
    """
    Deployment history. Triggering a deploy is a DevOps / privileged action.

    Deployments are executed by the configured provider (see ``deployments.providers``).
    Without a provider the API returns 503 and records nothing.
    """

    serializer_class = DeploymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["project", "environment", "status"]
    ordering_fields = ["started_at", "status"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Deployment.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return Deployment.objects.none()
        return Deployment.objects.filter(organization=user.organization).select_related("project", "triggered_by")

    def create(self, request, *args, **kwargs):
        if not request.user.can_deploy:
            raise PermissionDenied("Only DevOps Engineer, Tech Lead or CEO can trigger deployments.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            deployment = start_deployment(
                project=data["project"],
                environment=data.get("environment", Deployment.Environment.STAGING),
                branch=data.get("branch", "main"),
                commit_sha=data.get("commit_sha", ""),
                actor=request.user,
                organization=request.user.organization,
            )
        except DeploymentProviderNotConfigured as exc:
            raise DeploymentProviderUnavailable(str(exc))

        _notify_team(
            request.user,
            deployment,
            title=f"Deployment {deployment.status}: {deployment.project.name} ({deployment.environment})",
            message=f"{request.user.name or request.user.email} requested a deployment of {deployment.branch} to {deployment.environment}.",
        )
        code = status.HTTP_202_ACCEPTED if deployment.status == Deployment.Status.IN_PROGRESS else status.HTTP_502_BAD_GATEWAY
        return response.Response(self.get_serializer(deployment).data, status=code)

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
        """Ask the provider to redeploy the release recorded by the target deployment."""
        if not request.user.can_deploy:
            return response.Response({"detail": "Only DevOps or Tech Lead can trigger rollbacks."}, status=403)

        target = self.get_object()
        if target.status != Deployment.Status.SUCCESS or not target.commit_sha:
            return response.Response(
                {"detail": "Only a successful deployment with a recorded commit can be restored."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            deployment = start_deployment(
                project=target.project,
                environment=target.environment,
                branch=target.branch,
                commit_sha=target.commit_sha,
                actor=request.user,
                organization=request.user.organization,
                action="rollback",
            )
        except DeploymentProviderNotConfigured as exc:
            raise DeploymentProviderUnavailable(str(exc))

        _notify_team(
            request.user,
            deployment,
            title=f"Rollback {deployment.status}: {deployment.project.name} ({deployment.environment})",
            message=f"{request.user.name or request.user.email} requested a rollback to {target.commit_sha}.",
        )
        code = status.HTTP_202_ACCEPTED if deployment.status == Deployment.Status.IN_PROGRESS else status.HTTP_502_BAD_GATEWAY
        return response.Response(DeploymentSerializer(deployment).data, status=code)

    @decorators.action(
        detail=True,
        methods=["post"],
        url_path="provider_callback",
        permission_classes=[permissions.AllowAny],
        authentication_classes=[],
    )
    def provider_callback(self, request, pk=None):
        """Signed status report from the deployment provider."""
        body = request.body
        if not verify_signature(body, request.headers.get(SIGNATURE_HEADER, "")):
            return response.Response({"detail": "Invalid signature."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return response.Response({"detail": "Invalid JSON body."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(payload, dict):
            return response.Response({"detail": "Invalid JSON body."}, status=status.HTTP_400_BAD_REQUEST)

        deployment = get_object_or_404(Deployment.objects.select_related("project"), pk=pk)
        try:
            apply_provider_callback(deployment, payload)
        except ValueError as exc:
            return response.Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return response.Response({"id": deployment.id, "status": deployment.status})
