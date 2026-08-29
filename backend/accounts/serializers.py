from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    organization_tier = serializers.CharField(source="organization.subscription_tier", read_only=True)
    organization_status = serializers.CharField(source="organization.subscription_status", read_only=True)
    is_ai_agent = serializers.BooleanField(read_only=True)
    open_tasks_count = serializers.SerializerMethodField()
    closed_tasks_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "role",
            "agent_key",
            "is_ai_agent",
            "user_status",
            "avatar_url",
            "bio",
            "is_active",
            "date_joined",
            "organization",
            "organization_name",
            "organization_tier",
            "organization_status",
            "open_tasks_count",
            "closed_tasks_count",
        ]
        read_only_fields = ["id", "agent_key", "date_joined", "is_active", "organization"]

    def get_open_tasks_count(self, obj):
        return obj.assigned_tasks.exclude(status="done").count()

    def get_closed_tasks_count(self, obj):
        return obj.assigned_tasks.filter(status="done").count()


class ProfileSerializer(UserSerializer):
    """Self-service profile serializer that cannot escalate identity or roles."""

    class Meta(UserSerializer.Meta):
        read_only_fields = [
            *UserSerializer.Meta.read_only_fields,
            "email",
            "role",
            "user_status",
        ]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    organization_name = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ["id", "email", "name", "password", "role", "organization_name"]

    def create(self, validated_data):
        org_name = validated_data.pop("organization_name", None)
        password = validated_data.pop("password")

        if not org_name:
            email = validated_data.get("email", "")
            if "@" in email:
                domain = email.split("@")[-1]
                company_name = domain.split(".")[0].capitalize()
            else:
                company_name = "My"
            org_name = f"{company_name} Workspace"

        from organizations.models import Organization
        org = Organization.objects.create(name=org_name)

        # First registering user is CEO / Admin
        validated_data["role"] = User.Role.CEO
        validated_data["organization"] = org

        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class MemberCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, default="teamflow-demo-pw")

    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "user_status", "password", "bio"]

    def create(self, validated_data):
        password = validated_data.pop("password", "teamflow-demo-pw")
        request = self.context.get("request")
        user = User(**validated_data)
        if request and request.user.organization:
            user.organization = request.user.organization
        user.set_password(password)
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])
