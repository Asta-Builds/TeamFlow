from django.contrib.auth import get_user_model
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, permissions, serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import RegisterSerializer, UserSerializer


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — create a new account (open)."""

    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/me/ — the current authenticated user."""

    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


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
    """CRUD over users. Constrained to the user's organization."""

    serializer_class = UserSerializer
    filterset_fields = ["role", "is_active"]
    search_fields = ["email", "name"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return User.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return User.objects.none()
        if user.organization_id is None:
            return User.objects.filter(pk=user.pk)
        return User.objects.filter(organization=user.organization)
