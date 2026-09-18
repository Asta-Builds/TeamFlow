from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from organizations.membership import add_member, is_reserved_agent_email
from organizations.models import Membership, Organization

User = get_user_model()


def validate_person_email(value):
    if is_reserved_agent_email(value):
        raise serializers.ValidationError("This address is reserved for AI agent seats.")
    return value


class UserBriefSerializer(serializers.ModelSerializer):
    """
    High-performance lightweight serializer for nested representations
    (e.g., project members, task assignees, comment authors) avoiding N+1 queries.
    """
    organization_name = serializers.SerializerMethodField()
    is_ai_agent = serializers.BooleanField(read_only=True)

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
            "organization",
            "organization_name",
        ]
        read_only_fields = fields

    def get_organization_name(self, obj):
        if hasattr(obj, "_state") and "organization" in obj._state.fields_cache:
            org = obj._state.fields_cache["organization"]
            return org.name if org else None
        return None


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

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Team listings report the person's role in the viewer's workspace.
        workspace_role = getattr(instance, "workspace_role", None)
        if workspace_role:
            data["role"] = workspace_role
        return data

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
        read_only_fields = ["role"]

    def validate_email(self, value):
        return validate_person_email(value)

    @transaction.atomic
    def create(self, validated_data):
        org_name = (validated_data.pop("organization_name", None) or "").strip()
        password = validated_data.pop("password")
        email = validated_data.get("email", "")
        org = Organization.objects.create(
            name=org_name or f"{validated_data.get('name') or email.split('@')[0]}'s workspace"
        )

        # A new account always founds its own workspace as its CEO.
        user = User(**validated_data, role=User.Role.CEO, organization=org)
        user.set_password(password)
        user.save()
        add_member(user, org, Membership.Role.OWNER)
        return user


class MemberCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    role = serializers.ChoiceField(choices=Membership.Role.choices, default=Membership.Role.MEMBER)

    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "user_status", "password", "bio"]

    def validate_email(self, value):
        return validate_person_email(value)

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop("password")
        organization = self.context["request"].user.organization
        user = User(**validated_data, organization=organization)
        user.set_password(password)
        user.save()
        add_member(user, organization, user.role)
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])
