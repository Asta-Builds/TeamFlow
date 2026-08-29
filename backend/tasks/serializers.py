from rest_framework import serializers

from accounts.serializers import UserSerializer
from .models import Comment, Task, TaskActivity


class CommentSerializer(serializers.ModelSerializer):
    author_detail = UserSerializer(source="author", read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "task", "author", "author_detail", "body", "created_at"]
        read_only_fields = ["id", "author", "created_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["author"] = request.user
        return super().create(validated_data)

    def validate_task(self, task):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            if task.organization_id != request.user.organization_id:
                raise serializers.ValidationError("Task does not belong to your organization.")
        return task


class TaskActivitySerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    class Meta:
        model = TaskActivity
        fields = ["id", "task", "actor", "actor_detail", "action", "details", "created_at"]
        read_only_fields = ["id", "actor", "created_at"]


class TaskSerializer(serializers.ModelSerializer):
    assignee_detail = UserSerializer(source="assignee", read_only=True)
    created_by_detail = UserSerializer(source="created_by", read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    activities = TaskActivitySerializer(many=True, read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "project",
            "project_name",
            "title",
            "description",
            "status",
            "task_type",
            "priority",
            "assignee",
            "assignee_detail",
            "created_by",
            "created_by_detail",
            "due_date",
            "pr_url",
            "validation_contract",
            "contract_compliance_score",
            "qa_rejected",
            "qa_rejection_reason",
            "order",
            "comments",
            "activities",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["created_by"] = request.user
            validated_data["organization"] = request.user.organization
        return super().create(validated_data)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return attrs

        organization_id = request.user.organization_id
        project = attrs.get("project") or getattr(self.instance, "project", None)
        assignee = attrs.get("assignee", getattr(self.instance, "assignee", None))
        if project and project.organization_id != organization_id:
            raise serializers.ValidationError({"project": "Project does not belong to your organization."})
        if assignee and assignee.organization_id != organization_id:
            raise serializers.ValidationError({"assignee": "Assignee does not belong to your organization."})
        return attrs
