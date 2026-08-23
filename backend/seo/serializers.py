from rest_framework import serializers

from .models import SEOAudit


class SEOAuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = SEOAudit
        fields = [
            "id",
            "url",
            "score",
            "performance_score",
            "seo_score",
            "mobile_score",
            "load_time_ms",
            "issues",
            "metrics",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "score",
            "performance_score",
            "seo_score",
            "mobile_score",
            "load_time_ms",
            "issues",
            "metrics",
            "created_at",
        ]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["organization"] = request.user.organization
        return super().create(validated_data)
