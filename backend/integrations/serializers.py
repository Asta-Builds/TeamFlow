from rest_framework import serializers
from .models import SlackIntegration


class SlackIntegrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SlackIntegration
        fields = [
            "id",
            "organization",
            "webhook_url",
            "bot_token",
            "default_channel",
            "devops_channel",
            "qa_channel",
            "seo_channel",
            "is_enabled",
            "notify_on_ticket_assigned",
            "notify_on_deployment",
            "notify_on_qa_rejection",
            "notify_on_seo_drop",
            "notify_on_agent_response",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "organization", "created_at", "updated_at"]
