import json
import logging
import urllib.parse
import urllib.request
from urllib.parse import urlparse
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import OuterRef, Subquery
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, status, viewsets, decorators
from rest_framework.response import Response
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from organizations.membership import (
    HUMAN_ROLES,
    add_member,
    human_role_for,
    is_reserved_agent_email,
    workspace_people,
)
from organizations.models import Membership, Organization
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


def _keycloak_endpoint(path):
    return f"{settings.KEYCLOAK_URL.rstrip('/')}/protocol/openid-connect/{path}"


def _keycloak_json_request(url, *, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=8) as api_response:
        return json.loads(api_response.read().decode("utf-8"))


def _is_allowed_redirect_uri(redirect_uri):
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return origin in settings.CORS_ALLOWED_ORIGINS


def _role_from_keycloak_claims(claims):
    realm_access = claims.get("realm_access")
    if not isinstance(realm_access, dict) or "roles" not in realm_access:
        return None
    realm_roles = realm_access.get("roles", [])
    valid_roles = [
        User.Role.CEO,
        User.Role.PM,
        User.Role.TECH_LEAD,
        User.Role.DEVOPS,
        User.Role.QA,
        User.Role.BACKEND,
        User.Role.FRONTEND,
        User.Role.DESIGNER,
        User.Role.SEO,
        User.Role.ADMIN,
        User.Role.MEMBER,
    ]
    return next((role for role in valid_roles if role in realm_roles), User.Role.MEMBER)


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
        redirect_uri = request.data.get("redirect_uri")
        token = request.data.get("token") or request.data.get("access_token") or request.data.get("id_token")

        # 1. If an authorization code was received, exchange it with Keycloak
        if code and not token:
            if not redirect_uri:
                return Response(
                    {"detail": "redirect_uri is required when exchanging an authorization code."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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
        idp_role = role_from_claims(claims, {choice for choice, _label in User.Role.choices})

        # 3. Only an explicit organization claim selects a shared workspace.
        org_name = (
            claims.get("organization")
            or claims.get("org")
            or claims.get("tenant")
            or claims.get("workspace")
        )
        org_name = org_name.strip() if isinstance(org_name, str) else ""
        user = _provision_keycloak_user(email, name, idp_role, org_name)

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


@transaction.atomic
def _provision_keycloak_user(email, name, idp_role, org_name):
    """
    Find or create the person behind verified Keycloak claims.

    New people found their own workspace unless the identity provider names one.
    Roles from the identity provider are mapped onto the roles a person can hold.
    """
    user = User.objects.filter(email=email).first()
    if user is not None and (user.agent_key or not user.is_active):
        raise AuthenticationFailed("This account cannot sign in.")
    if user is None and is_reserved_agent_email(email):
        raise AuthenticationFailed("This address is reserved for AI agent seats.")

    org = Organization.objects.filter(name=org_name).order_by("id").first() if org_name else None
    created_org = False
    if org is None and (org_name or user is None):
        org = Organization.objects.create(name=org_name or f"{name}'s workspace")
        created_org = True
    role = Membership.Role.OWNER if created_org else human_role_for(idp_role or Membership.Role.MEMBER)

    if user is None:
        user = User(email=email, name=name, role=role, organization=org, user_status=User.Status.ACTIVE)
        user.set_unusable_password()
        user.save()
        add_member(user, org, role)
        return user

    if org is not None:
        seat = Membership.objects.filter(user=user, organization=org).first()
        if seat is None or idp_role is not None or created_org:
            seat = add_member(user, org, role)
        elif seat.status != Membership.Status.ACTIVE:
            seat.status = Membership.Status.ACTIVE
            seat.save(update_fields=["status", "updated_at"])
        if user.organization_id in (None, org.id):
            user.organization = org
            user.role = seat.role
            user.save(update_fields=["organization", "role"])
    return user


class ClerkAuthView(APIView):
    """
    POST /api/auth/clerk/ — disabled.

    Clerk sign-in is handled by the NestJS API, which verifies the Clerk session
    token signature against the configured issuer. This service cannot verify
    Clerk tokens, so it never exchanges them for TeamFlow credentials.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        return Response(
            {"detail": "Clerk sign-in is served by the TeamFlow API."},
            status=status.HTTP_404_NOT_FOUND,
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
        seat_role = Membership.objects.filter(
            user=OuterRef("pk"), organization_id=user.organization_id
        ).values("role")[:1]
        return (
            workspace_people(user.organization)
            .annotate(workspace_role=Subquery(seat_role))
            .prefetch_related("assigned_tasks")
        )

    def perform_create(self, serializer):
        actor = self.request.user
        if not actor.is_privileged or actor.organization_id is None:
            raise PermissionDenied("Only workspace admins can add members.")
        if serializer.validated_data.get("role") in MANAGER_ROLES and not _is_owner(actor):
            raise PermissionDenied("Only workspace owners can grant owner or admin roles.")
        serializer.save()

    @transaction.atomic
    def perform_update(self, serializer):
        actor = self.request.user
        target = serializer.instance
        if "role" in self.request.data or "user_status" in self.request.data:
            if not actor.is_privileged:
                raise PermissionDenied("Only workspace admins can change member roles.")

        new_role = serializer.validated_data.pop("role", None)
        if serializer.validated_data and target.pk != actor.pk and not (actor.is_staff or actor.is_superuser):
            seat_role = getattr(target, "workspace_role", None)
            if not target.agent_key and seat_role in MANAGER_ROLES and not _is_owner(actor):
                raise PermissionDenied("Only workspace owners can edit owner or admin accounts.")
            if _has_other_workspaces(target, actor.organization_id):
                raise PermissionDenied(
                    "This person also belongs to other workspaces; only their role here can change."
                )
        if new_role is not None:
            _change_workspace_role(actor, target, new_role)
        if serializer.validated_data:
            serializer.save()


MANAGER_ROLES = {Membership.Role.OWNER, Membership.Role.ADMIN}


def _is_owner(user):
    return user.is_staff or user.is_superuser or user.role == Membership.Role.OWNER


def _has_other_workspaces(target, organization_id):
    if target.agent_key:
        return target.organization_id != organization_id
    return target.memberships.exclude(organization_id=organization_id).exists()


def _change_workspace_role(actor, target, role):
    """Change a person's role in the actor's workspace, keeping at least one owner."""
    if target.agent_key:
        raise PermissionDenied("AI agent roles are defined by their seat.")
    if role not in HUMAN_ROLES:
        raise serializers.ValidationError({"role": "People can be CEO, Admin or Member."})
    if target.pk == actor.pk:
        raise PermissionDenied("You cannot change your own role.")
    seat = (
        Membership.objects.select_for_update()
        .filter(user=target, organization_id=actor.organization_id)
        .first()
    )
    if seat is None:
        raise PermissionDenied("This person is not a member of your workspace.")
    if (seat.role in MANAGER_ROLES or role in MANAGER_ROLES) and not _is_owner(actor):
        raise PermissionDenied("Only workspace owners can grant or revoke owner or admin roles.")
    if seat.role == Membership.Role.OWNER and role != Membership.Role.OWNER:
        other_owners = Membership.objects.filter(
            organization_id=actor.organization_id,
            role=Membership.Role.OWNER,
            status=Membership.Status.ACTIVE,
        ).exclude(pk=seat.pk)
        if not other_owners.exists():
            raise PermissionDenied("A workspace needs at least one owner.")
    seat.role = role
    seat.save(update_fields=["role", "updated_at"])
    target.workspace_role = role
    if target.organization_id == actor.organization_id:
        target.role = role
        target.save(update_fields=["role"])
