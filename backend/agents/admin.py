from django.contrib import admin
from django.utils.html import format_html

from .models import AgentExecutionTrace, AgentEvent, CodebaseEmbedding


@admin.register(AgentExecutionTrace)
class AgentExecutionTraceAdmin(admin.ModelAdmin):
    list_display = ["id", "task", "session_id", "status_badge", "tokens_display", "cost_usd", "duration_seconds", "created_at"]
    list_filter = ["status", "created_at"]
    search_fields = ["session_id", "task__title"]
    readonly_fields = ["created_at", "finished_at"]

    def status_badge(self, obj):
        colors = {
            "RUNNING": ("#3b82f6", "rgba(59, 130, 246, 0.15)"),
            "SUCCESS": ("#10b981", "rgba(16, 185, 129, 0.15)"),
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

    def tokens_display(self, obj):
        return format_html('<code style="font-family:ui-monospace, monospace; color:#a78bfa;">{:,}</code>', obj.tokens_used)
    tokens_display.short_description = "Tokens"
    tokens_display.admin_order_field = "tokens_used"


@admin.register(AgentEvent)
class AgentEventAdmin(admin.ModelAdmin):
    list_display = ["id", "session_id", "event_type", "sender_key", "recipient_key", "task", "created_at"]
    list_filter = ["event_type", "organization", "project", "created_at"]
    search_fields = ["session_id", "sender_key", "recipient_key", "message"]
    readonly_fields = ["created_at"]


@admin.register(CodebaseEmbedding)
class CodebaseEmbeddingAdmin(admin.ModelAdmin):
    list_display = ["file_path", "chunk_index", "project", "organization", "created_at"]
    list_filter = ["project", "organization", "created_at"]
    search_fields = ["file_path", "content"]
    readonly_fields = ["created_at", "updated_at"]
