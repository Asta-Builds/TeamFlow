from rest_framework import serializers
from accounts.serializers import UserSerializer
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_detail = UserSerializer(source="actor", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id",
            "recipient",
            "actor",
            "actor_detail",
            "title",
            "message",
            "link",
            "is_read",
            "created_at",
        ]
        read_only_fields = ["id", "actor", "created_at"]
