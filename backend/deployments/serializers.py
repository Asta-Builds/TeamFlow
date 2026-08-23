from rest_framework import serializers

from accounts.serializers import UserSerializer
from .models import Deployment


class DeploymentSerializer(serializers.ModelSerializer):
    triggered_by_detail = UserSerializer(source="triggered_by", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Deployment
        fields = [
            "id",
            "project",
            "project_name",
            "environment",
            "status",
            "commit_sha",
            "triggered_by",
            "triggered_by_detail",
            "started_at",
            "finished_at",
        ]
        read_only_fields = ["id", "triggered_by", "started_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["triggered_by"] = request.user
            validated_data["organization"] = request.user.organization
        return super().create(validated_data)
