from django.contrib import admin
from .models import SlackIntegration, GitHubIntegration


@admin.register(SlackIntegration)
class SlackIntegrationAdmin(admin.ModelAdmin):
    list_display = ["organization", "is_enabled", "default_channel", "created_at"]
    list_filter = ["is_enabled", "created_at"]
    search_fields = ["organization__name", "default_channel"]


@admin.register(GitHubIntegration)
class GitHubIntegrationAdmin(admin.ModelAdmin):
    list_display = ["organization", "account_login", "github_org", "default_visibility", "is_enabled", "created_at"]
    list_filter = ["is_enabled", "default_visibility", "created_at"]
    search_fields = ["organization__name", "account_login", "github_org"]
