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


class GitHubIntegration(models.Model):
    """
    GitHub Integration settings per Organization.
    Stores GitHub Personal Access Token (PAT), Default Organization/Owner,
    Default Repository Visibility, and cached account metadata.
    Used by DevOps Specialist Agent (Joan of Arc) to autonomously provision and manage Git repositories.
    """
    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"

    organization = models.OneToOneField(
        Organization,
        on_delete=models.CASCADE,
        related_name="github_integration"
    )
    github_token = models.CharField(
        max_length=255,
        blank=True,
        help_text="GitHub Personal Access Token (ghp_... or gho_...) with repo/workflow scopes"
    )
    github_org = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Default GitHub Organization or User login (e.g. Asta-Builds)"
    )
    default_visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.PUBLIC
    )
    auto_init = models.BooleanField(default=True, help_text="Automatically initialize README.md on creation")
    include_ci_workflow = models.BooleanField(default=True, help_text="Automatically inject DevOps GitHub Actions CI workflow")
    is_enabled = models.BooleanField(default=True)

    # Cached verified account info from GitHub API
    account_login = models.CharField(max_length=100, blank=True, default="")
    account_name = models.CharField(max_length=150, blank=True, default="")
    account_avatar_url = models.URLField(max_length=500, blank=True, default="")
    account_type = models.CharField(max_length=50, blank=True, default="User")
    public_repos_count = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"GitHub Integration ({self.organization.name} - @{self.github_org or self.account_login or 'unconfigured'})"

