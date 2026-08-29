from rest_framework import serializers
from .models import AgentEvent, AgentExecutionTrace, CodebaseEmbedding


class AgentEventSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.name", read_only=True, default="")
    sender_role = serializers.CharField(source="sender.role", read_only=True, default="system")
    task_title = serializers.CharField(source="task.title", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = AgentEvent
        fields = [
            "id",
            "session_id",
            "event_type",
            "sender_key",
            "sender_name",
            "sender_role",
            "recipient_key",
            "message",
            "current_work",
            "remaining_work",
            "metadata",
            "task",
            "task_title",
            "project",
            "project_name",
            "trace",
            "created_at",
        ]
        read_only_fields = fields


class CodebaseEmbeddingSerializer(serializers.ModelSerializer):
    class Meta:
        model = CodebaseEmbedding
        fields = [
            "id",
            "project",
            "file_path",
            "chunk_index",
            "content",
            "metadata",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class AgentExecutionTraceSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source="task.title", read_only=True)
    project_id = serializers.IntegerField(source="task.project_id", read_only=True)
    project_name = serializers.CharField(source="task.project.name", read_only=True)

    class Meta:
        model = AgentExecutionTrace
        fields = [
            "id",
            "task",
            "task_title",
            "project_id",
            "project_name",
            "session_id",
            "status",
            "graph_state",
            "steps",
            "tokens_used",
            "cost_usd",
            "duration_seconds",
            "langfuse_url",
            "created_at",
            "finished_at",
        ]
        read_only_fields = ["id", "created_at", "finished_at"]


class AgentDispatchSerializer(serializers.Serializer):
    task_id = serializers.IntegerField(required=True)
    auto_apply = serializers.BooleanField(default=True)
    model_override = serializers.CharField(required=False, allow_blank=True)
