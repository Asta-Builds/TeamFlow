from django.contrib import admin
from django.utils.html import format_html

from .models import Project


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "status_badge", "owner", "organization", "created_at"]
    list_filter = ["status", "organization", "created_at"]
    search_fields = ["name", "description"]
    readonly_fields = ["created_at", "updated_at"]

    def status_badge(self, obj):
        colors = {
            "PLANNING": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "ACTIVE": ("#10b981", "rgba(16, 185, 129, 0.15)"),
            "PAUSED": ("#f59e0b", "rgba(245, 158, 11, 0.15)"),
            "COMPLETED": ("#8b5cf6", "rgba(139, 92, 246, 0.15)"),
            "ARCHIVED": ("#6b7280", "rgba(107, 114, 128, 0.15)"),
        }
        text_color, bg_color = colors.get(obj.status, ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:11px; font-weight:600; '
            'border-radius:9999px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.status,
        )
    status_badge.short_description = "Status"
    status_badge.admin_order_field = "status"
