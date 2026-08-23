from rest_framework import serializers

from accounts.serializers import UserSerializer
from .models import Project


class ProjectSerializer(serializers.ModelSerializer):
    owner_detail = UserSerializer(source="owner", read_only=True)
    task_count = serializers.IntegerField(source="tasks.count", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "status",
            "owner",
            "owner_detail",
            "members",
            "task_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["organization"] = request.user.organization
            if not validated_data.get("owner"):
                validated_data["owner"] = request.user
        return super().create(validated_data)
