from django.contrib import admin
from django.utils.html import format_html

from .models import Deployment


@admin.register(Deployment)
class DeploymentAdmin(admin.ModelAdmin):
    list_display = ["project", "env_badge", "status_badge", "commit_sha_truncated", "triggered_by", "started_at"]
    list_filter = ["environment", "status", "organization", "started_at"]
    search_fields = ["commit_sha", "project__name", "triggered_by__email"]
    readonly_fields = ["started_at", "finished_at"]

    def env_badge(self, obj):
        colors = {
            "PRODUCTION": ("#ef4444", "rgba(239, 68, 68, 0.15)"),
            "STAGING": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "DEVELOPMENT": ("#6b7280", "rgba(107, 114, 128, 0.15)"),
        }
        text_color, bg_color = colors.get(str(obj.environment).upper(), ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:700; '
            'border-radius:4px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.environment,
        )
    env_badge.short_description = "Environment"
    env_badge.admin_order_field = "environment"

    def status_badge(self, obj):
        colors = {
            "DEPLOYED": ("#10b981", "rgba(16, 185, 129, 0.15)"),
            "BUILDING": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "PENDING": ("#f59e0b", "rgba(245, 158, 11, 0.15)"),
            "FAILED": ("#ef4444", "rgba(239, 68, 68, 0.15)"),
        }
        text_color, bg_color = colors.get(str(obj.status).upper(), ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:600; '
            'border-radius:9999px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.status,
        )
    status_badge.short_description = "Status"
    status_badge.admin_order_field = "status"

    def commit_sha_truncated(self, obj):
        sha = obj.commit_sha[:8] if obj.commit_sha else "—"
        return format_html('<code style="font-family:ui-monospace, monospace; color:#60a5fa;">{}</code>', sha)
    commit_sha_truncated.short_description = "Commit"
