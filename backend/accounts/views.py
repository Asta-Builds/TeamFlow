import json
import logging
import urllib.request
import urllib.parse
from django.conf import settings
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets, decorators
from rest_framework.response import Response
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from organizations.models import Organization
from teamflow.permissions import IsPrivilegedOrReadOnly
from .keycloak import KeycloakTokenError, role_from_claims, verify_keycloak_token
from .serializers import (
    ChangePasswordSerializer,
    MemberCreateSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — create a new account and organization (open)."""

    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/me/ — the current authenticated user."""

    serializer_class = ProfileSerializer

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ — change password for authenticated user."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response({"old_password": ["Wrong password."]}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save()
        return Response({"status": "password updated successfully"})


class KeycloakAuthView(APIView):
    """
    POST /api/auth/keycloak/ — SSO login/token exchange via Keycloak.
    Accepts:
      - 'code' + 'redirect_uri' (Authorization Code Flow)
      - 'token' / 'access_token' / 'id_token' (Direct / Implicit Token Flow)
    Returns TeamFlow JWT tokens + User info.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        code = request.data.get("code")
        redirect_uri = request.data.get("redirect_uri") or "http://localhost:3000/auth/callback"
        token = request.data.get("token") or request.data.get("access_token") or request.data.get("id_token")

        # 1. If an authorization code was received, exchange it with Keycloak
        if code and not token:
            try:
                data = urllib.parse.urlencode({
                    "grant_type": "authorization_code",
                    "client_id": settings.KEYCLOAK_CLIENT_ID,
                    "code": code,
                    "redirect_uri": redirect_uri,
                }).encode("utf-8")
                req = urllib.request.Request(
                    settings.KEYCLOAK_TOKEN_URL,
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                with urllib.request.urlopen(
                    req,
                    timeout=settings.KEYCLOAK_HTTP_TIMEOUT_SECONDS,
                ) as resp:
                    token_res = json.loads(resp.read().decode("utf-8"))
                    token = token_res.get("access_token") or token_res.get("id_token")
            except Exception as exc:
                logger.warning("Keycloak authorization-code exchange failed: %s", exc)
                raise AuthenticationFailed("Keycloak authorization-code exchange failed.") from exc

        if not token:
            raise AuthenticationFailed("A verified Keycloak token or authorization code is required.")

        # 2. Trust identity and roles only after full JWT verification.
        try:
            claims = verify_keycloak_token(token)
        except KeycloakTokenError as exc:
            raise AuthenticationFailed(str(exc)) from exc

        email = (claims.get("email") or claims.get("preferred_username")).lower()
        name = claims.get("name") or claims.get("given_name", "") or email.split("@")[0]
        role = role_from_claims(claims, {choice for choice, _label in User.Role.choices})

        # 3. Get or create default Organization
        org, _ = Organization.objects.get_or_create(
            name="TeamFlow Workspace",
            defaults={
                "subscription_tier": Organization.Tier.GROWTH,
                "subscription_status": Organization.Status.ACTIVE,
            }
        )

        user = User.objects.filter(email=email).first()
        if not user:
            user = User.objects.create(
                email=email,
                name=name or email.split("@")[0],
                role=role or User.Role.MEMBER,
                organization=org,
                user_status=User.Status.ACTIVE,
            )
            user.set_unusable_password()
            user.save()
        else:
            if role and user.role != role:
                user.role = role
                user.save(update_fields=["role"])
            if not user.organization:
                user.organization = org
                user.save(update_fields=["organization"])

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout/ — blacklist the supplied refresh token."""

    serializer_class = LogoutSerializer

    @extend_schema(request=LogoutSerializer, responses={205: OpenApiTypes.NONE})
    def post(self, request):
        token = request.data.get("refresh")
        if not token:
            return Response({"detail": "refresh token required"}, status=400)
        try:
            RefreshToken(token).blacklist()
        except Exception:
            return Response({"detail": "invalid token"}, status=400)
        return Response(status=205)


class UserViewSet(viewsets.ModelViewSet):
    """CRUD over team members. Constrained to the user's organization."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated, IsPrivilegedOrReadOnly]
    filterset_fields = ["role", "user_status", "is_active"]
    search_fields = ["email", "name"]

    def get_serializer_class(self):
        if self.action == "create":
            return MemberCreateSerializer
        return UserSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return User.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return User.objects.none()
        if user.organization_id is None:
            return User.objects.filter(pk=user.pk)
        return User.objects.filter(organization=user.organization).prefetch_related("assigned_tasks")

    def perform_create(self, serializer):
        if not self.request.user.is_privileged:
            raise PermissionDenied("Only Tech Lead, CEO or Admin can add members.")
        serializer.save()

    def perform_update(self, serializer):
        if "role" in self.request.data or "user_status" in self.request.data:
            if not self.request.user.is_privileged:
                raise PermissionDenied("Only Tech Lead, CEO or Admin can change member roles.")
        serializer.save()
