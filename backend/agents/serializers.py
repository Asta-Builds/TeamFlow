from rest_framework import serializers
from .models import AgentExecutionTrace, CodebaseEmbedding


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
