from rest_framework import serializers

from accounts.serializers import UserSerializer
from .models import Project


class ProjectSerializer(serializers.ModelSerializer):
    owner_detail = UserSerializer(source="owner", read_only=True)
    members_detail = UserSerializer(source="members", many=True, read_only=True)
    task_count = serializers.IntegerField(source="tasks.count", read_only=True)
    done_task_count = serializers.SerializerMethodField()
    progress_percentage = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "status",
            "github_repo",
            "owner",
            "owner_detail",
            "members",
            "members_detail",
            "task_count",
            "done_task_count",
            "progress_percentage",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_done_task_count(self, obj):
        return obj.tasks.filter(status="done").count()

    def get_progress_percentage(self, obj):
        total = obj.tasks.count()
        if total == 0:
            return 0
        done = obj.tasks.filter(status="done").count()
        return round((done / total) * 100)

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["organization"] = request.user.organization
            if not validated_data.get("owner"):
                validated_data["owner"] = request.user
        return super().create(validated_data)
