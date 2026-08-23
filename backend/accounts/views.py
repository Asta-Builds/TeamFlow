import base64
import json
import logging
import os
import urllib.request
import urllib.parse
from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets, decorators
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from organizations.models import Organization
from teamflow.permissions import IsPrivilegedOrReadOnly
from .serializers import (
    ChangePasswordSerializer,
    MemberCreateSerializer,
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

    serializer_class = UserSerializer

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
      - 'email' + 'name' (Direct user sync fallback)
    Returns TeamFlow JWT tokens + User info.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        code = request.data.get("code")
        redirect_uri = request.data.get("redirect_uri") or "http://localhost:3000/auth/callback"
        token = request.data.get("token") or request.data.get("access_token") or request.data.get("id_token")
        email = request.data.get("email")
        name = request.data.get("name", "")
        role = request.data.get("role")

        # 1. If an authorization code was received, exchange it with Keycloak
        if code and not token:
            keycloak_url = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080/realms/teamflow")
            # Fallback to localhost if outside container
            urls_to_try = [
                f"{keycloak_url}/protocol/openid-connect/token",
                "http://localhost:8080/realms/teamflow/protocol/openid-connect/token",
                "http://127.0.0.1:8080/realms/teamflow/protocol/openid-connect/token",
            ]
            
            token_payload = None
            for token_url in urls_to_try:
                try:
                    data = urllib.parse.urlencode({
                        "grant_type": "authorization_code",
                        "client_id": "teamflow-app",
                        "code": code,
                        "redirect_uri": redirect_uri,
                    }).encode("utf-8")
                    req = urllib.request.Request(token_url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        token_res = json.loads(resp.read().decode("utf-8"))
                        token = token_res.get("access_token") or token_res.get("id_token")
                        if token:
                            break
                except Exception as ex:
                    logger.debug(f"Could not connect to Keycloak at {token_url}: {ex}")

        # 2. Parse JWT payload from token
        if token:
            try:
                parts = token.split(".")
                if len(parts) >= 2:
                    padding = "=" * (4 - len(parts[1]) % 4)
                    payload_bytes = base64.urlsafe_b64decode(parts[1] + padding)
                    payload = json.loads(payload_bytes)
                    email = payload.get("email") or payload.get("preferred_username") or email
                    name = payload.get("name") or payload.get("given_name", "") or name
                    
                    # Extract realm roles
                    realm_access = payload.get("realm_access", {})
                    realm_roles = realm_access.get("roles", [])
                    for r in [
                        User.Role.CEO,
                        User.Role.TECH_LEAD,
                        User.Role.DEVOPS,
                        User.Role.QA,
                        User.Role.BACKEND,
                        User.Role.FRONTEND,
                        User.Role.DESIGNER,
                        User.Role.SEO,
                        User.Role.ADMIN,
                    ]:
                        if r in realm_roles:
                            role = r
                            break
            except Exception as e:
                logger.warning(f"Failed to parse Keycloak JWT: {e}")

        if not email:
            return Response(
                {"detail": "Unable to extract email from Keycloak authentication. Check Keycloak client scopes."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            raise permissions.exceptions.PermissionDenied("Only Tech Lead, CEO or Admin can add members.")
        serializer.save()

    def perform_update(self, serializer):
        if "role" in self.request.data or "user_status" in self.request.data:
            if not self.request.user.is_privileged:
                raise permissions.exceptions.PermissionDenied("Only Tech Lead, CEO or Admin can change member roles.")
        serializer.save()
