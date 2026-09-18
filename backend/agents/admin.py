from django.contrib import admin
from .models import AgentExecutionTrace, AgentEvent, CodebaseEmbedding


@admin.register(AgentExecutionTrace)
class AgentExecutionTraceAdmin(admin.ModelAdmin):
    list_display = ["id", "task", "session_id", "status", "tokens_used", "cost_usd", "duration_seconds", "created_at"]
    list_filter = ["status", "created_at"]
    search_fields = ["session_id", "task__title"]
    readonly_fields = ["created_at", "finished_at"]


@admin.register(AgentEvent)
class AgentEventAdmin(admin.ModelAdmin):
    list_display = ["id", "session_id", "event_type", "sender_key", "recipient_key", "task", "created_at"]
    list_filter = ["event_type", "organization", "project"]
    search_fields = ["session_id", "sender_key", "recipient_key", "message"]
    readonly_fields = ["created_at"]


@admin.register(CodebaseEmbedding)
class CodebaseEmbeddingAdmin(admin.ModelAdmin):
    list_display = ["file_path", "chunk_index", "project", "organization", "created_at"]
    list_filter = ["project", "organization"]
    search_fields = ["file_path", "content"]
    readonly_fields = ["created_at", "updated_at"]
