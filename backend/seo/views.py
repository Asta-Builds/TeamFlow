from urllib.parse import urlparse

from rest_framework import permissions, viewsets

from teamflow.permissions import IsPrivilegedOrReadOnly
from .models import SEOAudit
from .serializers import SEOAuditSerializer


def run_stub_audit(url):
    """Placeholder audit. A Celery task will replace this (see blueprint).

    Returns a (score, issues) tuple based on cheap heuristics so the endpoint
    is usable end-to-end before the real crawler lands.
    """
    issues = []
    parsed = urlparse(url)
    if parsed.scheme != "https":
        issues.append({"severity": "high", "message": "Page is not served over HTTPS"})
    if len(url) > 100:
        issues.append({"severity": "low", "message": "URL is long; prefer concise slugs"})
    score = max(0, 100 - len(issues) * 20)
    return score, issues


class SEOAuditViewSet(viewsets.ModelViewSet):
    serializer_class = SEOAuditSerializer
    permission_classes = [permissions.IsAuthenticated, IsPrivilegedOrReadOnly]
    ordering_fields = ["created_at", "score"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SEOAudit.objects.none()
        user = self.request.user
        if not user.is_authenticated or user.organization is None:
            return SEOAudit.objects.none()
        return SEOAudit.objects.filter(organization=user.organization)

    def perform_create(self, serializer):
        url = serializer.validated_data["url"]
        score, issues = run_stub_audit(url)
        serializer.save(
            score=score,
            issues=issues,
            organization=self.request.user.organization
        )
