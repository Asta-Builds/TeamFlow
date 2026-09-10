import os
import logging
import hashlib
import hmac
import time
import requests
from django.conf import settings
from rest_framework import views, status, permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from .models import SlackIntegration, GitHubIntegration
from .serializers import SlackIntegrationSerializer, GitHubIntegrationSerializer
from .slack_service import send_slack_notification

logger = logging.getLogger(__name__)


def require_workspace_admin(request):
    if not request.user.is_privileged:
        raise PermissionDenied("Only Tech Lead, CEO or Admin can manage workspace integrations.")


def has_valid_slack_signature(request):
    signing_secret = getattr(settings, "SLACK_SIGNING_SECRET", "")
    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")
    if not signing_secret or not timestamp or not signature:
        return False

    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except ValueError:
        return False

    base_string = b"v0:" + timestamp.encode("utf-8") + b":" + request.body
    expected = "v0=" + hmac.new(
        signing_secret.encode("utf-8"), base_string, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


class SlackIntegrationView(views.APIView):
    """
    GET /api/integrations/slack/
    POST /api/integrations/slack/connect/
    Manages the Slack Workspace Integration settings.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        require_workspace_admin(request)
        integration, _ = SlackIntegration.objects.get_or_create(
            organization=request.user.organization
        )
        serializer = SlackIntegrationSerializer(integration)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        require_workspace_admin(request)
        integration, _ = SlackIntegration.objects.get_or_create(
            organization=request.user.organization
        )
        serializer = SlackIntegrationSerializer(integration, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SlackTestView(views.APIView):
    """
    POST /api/integrations/slack/test/
    Sends an immediate test message to the configured Slack channel.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        require_workspace_admin(request)
        integration = SlackIntegration.objects.filter(
            organization=request.user.organization
        ).first()
        
        if not integration or not integration.webhook_url:
            return Response(
                {"detail": "Please configure a valid Slack Webhook URL first."},
                status=status.HTTP_400_BAD_REQUEST
            )

        result = send_slack_notification(
            organization=request.user.organization,
            event_type="ticket_assigned",
            title="TeamFlow Slack Integration Verified",
            message=f"Test notification triggered by {request.user.name or request.user.email}. Webhook and channel routing are active.",
            details={
                "environment": "Production/Staging",
                "triggered_by": request.user.email,
                "default_channel": integration.default_channel,
                "devops_channel": integration.devops_channel,
                "qa_channel": integration.qa_channel,
                "seo_channel": integration.seo_channel,
            },
            action_url="/settings"
        )

        if result.get("ok"):
            return Response({"ok": True, "message": "Test notification delivered to Slack!"})
        return Response({"ok": False, "detail": result.get("error") or result.get("reason", "Failed to deliver")}, status=status.HTTP_502_BAD_GATEWAY)


class SlackEventsWebhookView(views.APIView):
    """
    POST /api/integrations/slack/events/
    Public receiver endpoint for Slack Events API (URL verification & interactive actions).
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        if not getattr(settings, "SLACK_SIGNING_SECRET", ""):
            return Response(
                {"detail": "Slack event signing secret is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if not has_valid_slack_signature(request):
            return Response({"detail": "Invalid Slack request signature."}, status=status.HTTP_403_FORBIDDEN)

        # 1. Handle Slack URL Verification Challenge
        if request.data.get("type") == "url_verification":
            return Response({"challenge": request.data.get("challenge")})

        # 2. Handle interactive button payloads or event callbacks
        event = request.data.get("event", {})
        event_type = event.get("type")
        logger.info(f"Received Slack Event: {event_type}")

        return Response({"status": "received"}, status=status.HTTP_200_OK)


class GitHubIntegrationView(views.APIView):
    """
    GET /api/integrations/github/
    POST /api/integrations/github/connect/
    Manages GitHub Workspace Integration settings for autonomous DevOps repo creation.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        require_workspace_admin(request)
        integration, _ = GitHubIntegration.objects.get_or_create(
            organization=request.user.organization
        )
        data = GitHubIntegrationSerializer(integration).data
        env_token = os.environ.get("GITHUB_TOKEN", "").strip()
        env_org = os.environ.get("GITHUB_ORG", "").strip()
        if not data.get("github_token_configured") and env_token:
            data["github_token_configured"] = True
            data["github_token_preview"] = f"{env_token[:4]}...{env_token[-4:]}" if len(env_token) > 8 else "****"
            data["is_env_configured"] = True
        if not data.get("github_org") and env_org:
            data["github_org"] = env_org
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request):
        require_workspace_admin(request)
        integration, _ = GitHubIntegration.objects.get_or_create(
            organization=request.user.organization
        )
        serializer = GitHubIntegrationSerializer(integration, data=request.data, partial=True)
        if serializer.is_valid():
            integration = serializer.save()
            tok = integration.github_token or os.environ.get("GITHUB_TOKEN", "").strip()
            if tok:
                try:
                    resp = requests.get(
                        "https://api.github.com/user",
                        headers={"Authorization": f"token {tok}", "Accept": "application/vnd.github.v3+json"},
                        timeout=8
                    )
                    if resp.status_code == 200:
                        u_data = resp.json()
                        integration.account_login = u_data.get("login", "")
                        integration.account_name = u_data.get("name") or u_data.get("login", "")
                        integration.account_avatar_url = u_data.get("avatar_url", "")
                        integration.account_type = u_data.get("type", "User")
                        integration.public_repos_count = u_data.get("public_repos", 0)
                        if not integration.github_org:
                            integration.github_org = u_data.get("login", "")
                        integration.save()
                except Exception as exc:
                    logger.warning(f"Failed to auto-fetch GitHub account details: {exc}")

            return Response(GitHubIntegrationSerializer(integration).data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class GitHubTestView(views.APIView):
    """
    POST /api/integrations/github/test/
    Tests connection to GitHub API and verifies credentials, returning account metadata.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        require_workspace_admin(request)
        integration = GitHubIntegration.objects.filter(organization=request.user.organization).first()
        token = request.data.get("github_token", "").strip()
        if not token and integration:
            token = integration.github_token
        if not token:
            token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", "")).strip()

        if not token:
            return Response(
                {"ok": False, "detail": "No GitHub Personal Access Token configured. Please provide a valid PAT."},
                status=status.HTTP_400_BAD_REQUEST
            )

        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "TeamFlow-DevOps-Agent"
        }

        try:
            resp = requests.get("https://api.github.com/user", headers=headers, timeout=10)
            if resp.status_code == 200:
                user_data = resp.json()
                login = user_data.get("login", "")
                name = user_data.get("name") or login
                avatar = user_data.get("avatar_url", "")
                acc_type = user_data.get("type", "User")
                repos_count = user_data.get("public_repos", 0)

                if integration:
                    integration.account_login = login
                    integration.account_name = name
                    integration.account_avatar_url = avatar
                    integration.account_type = acc_type
                    integration.public_repos_count = repos_count
                    if not integration.github_org:
                        integration.github_org = login
                    integration.save()

                return Response({
                    "ok": True,
                    "message": f"Successfully connected to GitHub as @{login} ({name})!",
                    "account": {
                        "login": login,
                        "name": name,
                        "avatar_url": avatar,
                        "type": acc_type,
                        "public_repos": repos_count,
                        "html_url": user_data.get("html_url", f"https://github.com/{login}"),
                    }
                }, status=status.HTTP_200_OK)
            elif resp.status_code == 401:
                return Response({
                    "ok": False,
                    "detail": "Bad GitHub credentials (401 Unauthorized). Check that your Personal Access Token is valid and not expired."
                }, status=status.HTTP_401_UNAUTHORIZED)
            else:
                return Response({
                    "ok": False,
                    "detail": f"GitHub API error: HTTP {resp.status_code} - {resp.text}"
                }, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as exc:
            return Response({
                "ok": False,
                "detail": f"Connection error reaching GitHub: {str(exc)}"
            }, status=status.HTTP_502_BAD_GATEWAY)

