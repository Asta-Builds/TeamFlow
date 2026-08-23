from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    organization_tier = serializers.CharField(source="organization.subscription_tier", read_only=True)
    organization_status = serializers.CharField(source="organization.subscription_status", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "role",
            "avatar_url",
            "is_active",
            "date_joined",
            "organization",
            "organization_name",
            "organization_tier",
            "organization_status",
        ]
        read_only_fields = ["id", "date_joined", "is_active", "organization"]


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

        # First registering user is Admin
        validated_data["role"] = User.Role.ADMIN
        validated_data["organization"] = org

        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user
