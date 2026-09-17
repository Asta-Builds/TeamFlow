from django.shortcuts import get_object_or_404
from rest_framework import decorators, permissions, response, status, viewsets
from rest_framework.exceptions import APIException, PermissionDenied

from projects.models import Project
from tasks.models import Task
from teamflow.permissions import visible_projects_for
from .models import SEOAudit
from .serializers import SEOAuditSerializer


class SEOAuditUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "seo_audit_unavailable"
    default_detail = "SEO audits are run by the primary TeamFlow API."


class SEOAuditViewSet(viewsets.ModelViewSet):
    serializer_class = SEOAuditSerializer
    permission_classes = [permissions.IsAuthenticated]
    ordering_fields = ["created_at", "score"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SEOAudit.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return SEOAudit.objects.none()
        return SEOAudit.objects.filter(organization=user.organization)

    def perform_create(self, serializer):
        user = self.request.user
        if not user.can_audit_seo:
            raise PermissionDenied("Only SEO Specialist, Tech Lead or CEO can run audits.")

        # Audits are executed by the NestJS API, which fetches and inspects the page.
        # This service never records invented scores or metrics.
        raise SEOAuditUnavailable()

    @decorators.action(detail=True, methods=["post"])
    def create_task(self, request, pk=None):
        """Convert an SEO audit issue into a project ticket in 1-click."""
        audit = self.get_object()
        project_id = request.data.get("project_id")
        issue_index = int(request.data.get("issue_index", 0))

        if not project_id:
            return response.Response({"project_id": ["Project is required."]}, status=400)

        if issue_index < 0 or issue_index >= len(audit.issues):
            return response.Response({"detail": "Invalid issue index."}, status=400)

        project = get_object_or_404(visible_projects_for(request.user), pk=project_id)
        issue = audit.issues[issue_index]
        project = get_object_or_404(
            Project,
            pk=project_id,
            organization=request.user.organization,
        )
        task = Task.objects.create(
            project=project,
            title=f"SEO: {issue.get('message', 'Fix SEO Issue')[:80]}",
            description=f"Automated ticket created from SEO audit on {audit.url}.\n\nRecommendation: {issue.get('recommendation', '')}",
            task_type=Task.Type.TASK,
            priority=Task.Priority.HIGH if issue.get("severity") in {"critical", "high"} else Task.Priority.MEDIUM,
            created_by=request.user,
            organization=request.user.organization,
        )
        return response.Response({"status": "task created", "task_id": task.id}, status=status.HTTP_201_CREATED)
