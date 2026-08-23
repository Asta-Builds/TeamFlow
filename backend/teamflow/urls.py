"""URL configuration for the TeamFlow API."""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.views import LogoutView, MeView, RegisterView, UserViewSet
from deployments.views import DeploymentViewSet
from projects.views import ProjectViewSet
from seo.views import SEOAuditViewSet
from tasks.views import CommentViewSet, TaskViewSet
from organizations.views import (
    CreateCheckoutSessionView,
    CreatePortalSessionView,
    StripeWebhookView,
    MockConfirmSubscriptionView,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("projects", ProjectViewSet, basename="project")
router.register("tasks", TaskViewSet, basename="task")
router.register("comments", CommentViewSet, basename="comment")
router.register("deployments", DeploymentViewSet, basename="deployment")
router.register("seo/audits", SEOAuditViewSet, basename="seoaudit")


def health(_request):
    return JsonResponse({"status": "ok", "service": "teamflow-api"})


auth_patterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", TokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/auth/", include(auth_patterns)),
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
