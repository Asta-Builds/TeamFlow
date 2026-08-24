import logging
from rest_framework import views, status, permissions
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from .models import SlackIntegration
from .serializers import SlackIntegrationSerializer
from .slack_service import send_slack_notification

logger = logging.getLogger(__name__)


class SlackIntegrationView(views.APIView):
    """
    GET /api/integrations/slack/
    POST /api/integrations/slack/connect/
    Manages the Slack Workspace Integration settings.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        integration, _ = SlackIntegration.objects.get_or_create(
            organization=request.user.organization
        )
        serializer = SlackIntegrationSerializer(integration)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
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
            action_url="http://localhost:3000/settings"
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
        # 1. Handle Slack URL Verification Challenge
        if request.data.get("type") == "url_verification":
            return Response({"challenge": request.data.get("challenge")})

        # 2. Handle interactive button payloads or event callbacks
        event = request.data.get("event", {})
        event_type = event.get("type")
        logger.info(f"Received Slack Event: {event_type}")

        return Response({"status": "received"}, status=status.HTTP_200_OK)
