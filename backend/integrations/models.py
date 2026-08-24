from django.db import models
from organizations.models import Organization


class SlackIntegration(models.Model):
    """
    Slack Workspace Integration settings per Organization.
    Stores Incoming Webhook URL, Bot Token, Channel Routing, and Event Toggles.
    """
    organization = models.OneToOneField(
        Organization,
        on_delete=models.CASCADE,
        related_name="slack_integration"
    )
    webhook_url = models.URLField(
        max_length=500,
        blank=True,
        help_text="Slack Incoming Webhook URL (e.g. https://hooks.slack.com/services/...)"
    )
    bot_token = models.CharField(
        max_length=255,
        blank=True,
        help_text="Slack Bot User OAuth Token (xoxb-...)"
    )
    default_channel = models.CharField(max_length=100, default="#general")
    devops_channel = models.CharField(max_length=100, default="#devops")
    qa_channel = models.CharField(max_length=100, default="#qa")
    seo_channel = models.CharField(max_length=100, default="#seo")
    
    is_enabled = models.BooleanField(default=True)
    notify_on_ticket_assigned = models.BooleanField(default=True)
    notify_on_deployment = models.BooleanField(default=True)
    notify_on_qa_rejection = models.BooleanField(default=True)
    notify_on_seo_drop = models.BooleanField(default=True)
    notify_on_agent_response = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Slack Integration ({self.organization.name})"
