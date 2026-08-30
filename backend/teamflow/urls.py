"""URL configuration for the TeamFlow API."""

from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.views import (
    ChangePasswordView,
    KeycloakAuthView,
    LogoutView,
    MeView,
    RegisterView,
    UserViewSet,
)
from deployments.views import DeploymentViewSet
from notifications.views import NotificationViewSet
from organizations.views import (
    CreateCheckoutSessionView,
    CreatePortalSessionView,
    MockConfirmSubscriptionView,
    StripeWebhookView,
)
from projects.views import ProjectViewSet
from pulse.views import PulseDashboardView, PulseFocusSessionViewSet, PulseNoteView, PulsePlanItemViewSet
from seo.views import SEOAuditViewSet
from tasks.views import CommentViewSet, TaskViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("projects", ProjectViewSet, basename="project")
router.register("tasks", TaskViewSet, basename="task")
router.register("comments", CommentViewSet, basename="comment")
router.register("deployments", DeploymentViewSet, basename="deployment")
router.register("seo/audits", SEOAuditViewSet, basename="seoaudit")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("pulse/plan-items", PulsePlanItemViewSet, basename="pulse-plan-item")
router.register("pulse/focus-sessions", PulseFocusSessionViewSet, basename="pulse-focus-session")


def health(_request):
    db_ok = True
    try:
        connection.ensure_connection()
    except Exception:
        db_ok = False

    status_code = 200 if db_ok else 503
    return JsonResponse(
        {
            "status": "ok" if db_ok else "unhealthy",
            "service": "teamflow-api",
            "database": "connected" if db_ok else "disconnected",
        },
        status=status_code,
    )


auth_patterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", TokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("keycloak/", KeycloakAuthView.as_view(), name="keycloak-auth"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/auth/", include(auth_patterns)),
    path("api/agents/", include("agents.urls")),
    path("api/integrations/", include("integrations.urls")),
    path("api/pulse/dashboard/", PulseDashboardView.as_view(), name="pulse-dashboard"),
    path("api/pulse/note/", PulseNoteView.as_view(), name="pulse-note"),
    path("api/", include(router.urls)),
    # Billing
    path("api/billing/create-checkout-session/", CreateCheckoutSessionView.as_view(), name="billing-checkout"),
    path("api/billing/customer-portal/", CreatePortalSessionView.as_view(), name="billing-portal"),
    path("api/billing/webhook/", StripeWebhookView.as_view(), name="billing-webhook"),
    path("api/billing/mock-confirm/", MockConfirmSubscriptionView.as_view(), name="billing-mock-confirm"),
    # API docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
