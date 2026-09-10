from rest_framework import serializers
from .models import SlackIntegration, GitHubIntegration


class SlackIntegrationSerializer(serializers.ModelSerializer):
    webhook_url = serializers.URLField(write_only=True, required=False, allow_blank=True)
    bot_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    webhook_configured = serializers.SerializerMethodField()
    bot_token_configured = serializers.SerializerMethodField()

    class Meta:
        model = SlackIntegration
        fields = [
            "id",
            "organization",
            "webhook_url",
            "bot_token",
            "webhook_configured",
            "bot_token_configured",
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

    def get_webhook_configured(self, instance):
        return bool(instance.webhook_url)

    def get_bot_token_configured(self, instance):
        return bool(instance.bot_token)

    def validate_webhook_url(self, value):
        if not value:
            return value
        from urllib.parse import urlparse

        parsed = urlparse(value)
        if parsed.scheme != "https" or parsed.netloc != "hooks.slack.com":
            raise serializers.ValidationError("Use a valid HTTPS Slack Incoming Webhook URL.")
        return value


class GitHubIntegrationSerializer(serializers.ModelSerializer):
    github_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    github_token_configured = serializers.SerializerMethodField()
    github_token_preview = serializers.SerializerMethodField()

    class Meta:
        model = GitHubIntegration
        fields = [
            "id",
            "organization",
            "github_token",
            "github_token_configured",
            "github_token_preview",
            "github_org",
            "default_visibility",
            "auto_init",
            "include_ci_workflow",
            "is_enabled",
            "account_login",
            "account_name",
            "account_avatar_url",
            "account_type",
            "public_repos_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "organization",
            "github_token_configured",
            "github_token_preview",
            "account_login",
            "account_name",
            "account_avatar_url",
            "account_type",
            "public_repos_count",
            "created_at",
            "updated_at",
        ]

    def get_github_token_configured(self, instance):
        return bool(instance.github_token)

    def get_github_token_preview(self, instance):
        if not instance.github_token:
            return ""
        tok = instance.github_token.strip()
        if len(tok) <= 8:
            return "****"
        return f"{tok[:4]}...{tok[-4:]}"

