from django.contrib import admin
from django.utils.html import format_html

from .models import Comment, Task


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["title", "project", "task_type", "status_badge", "priority_badge", "assignee", "organization", "created_at"]
    list_filter = ["status", "priority", "task_type", "project", "organization"]
    search_fields = ["title", "description"]
    readonly_fields = ["created_at", "updated_at"]

    def status_badge(self, obj):
        colors = {
            "todo": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "in_progress": ("#8b5cf6", "rgba(139, 92, 246, 0.15)"),
            "in_review": ("#f59e0b", "rgba(245, 158, 11, 0.15)"),
            "qa": ("#06b6d4", "rgba(6, 182, 212, 0.15)"),
            "done": ("#10b981", "rgba(16, 185, 129, 0.15)"),
        }
        text_color, bg_color = colors.get(str(obj.status).lower(), ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:11px; font-weight:600; '
            'border-radius:9999px; background-color:{}; color:{}; text-transform:uppercase; '
            'font-family:ui-monospace, monospace;">{}</span>',
            bg_color,
            text_color,
            obj.get_status_display() if hasattr(obj, "get_status_display") else obj.status,
        )
    status_badge.short_description = "Status"
    status_badge.admin_order_field = "status"

    def priority_badge(self, obj):
        colors = {
            "urgent": ("#ef4444", "rgba(239, 68, 68, 0.15)"),
            "high": ("#f97316", "rgba(249, 115, 22, 0.15)"),
            "medium": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "low": ("#6b7280", "rgba(107, 114, 128, 0.15)"),
        }
        text_color, bg_color = colors.get(str(obj.priority).lower(), ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:700; '
            'border-radius:4px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.get_priority_display() if hasattr(obj, "get_priority_display") else obj.priority,
        )
    priority_badge.short_description = "Priority"
    priority_badge.admin_order_field = "priority"


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ["task", "author", "created_at"]
    list_filter = ["task__project", "created_at"]
    search_fields = ["body", "task__title", "author__email"]
    readonly_fields = ["created_at"]
