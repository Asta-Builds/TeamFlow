import os
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from organizations.models import Organization
from organizations.membership import add_member

User = get_user_model()


class Command(BaseCommand):
    help = "Creates or updates the primary platform superuser/admin accounts and ensures workspace access."

    def add_arguments(self, parser):
        parser.add_argument("--email", default=os.getenv("DJANGO_SUPERUSER_EMAIL", "abdelilahdahou10@gmail.com"))
        parser.add_argument("--password", default=os.getenv("DJANGO_SUPERUSER_PASSWORD", "abdelilah131261@"))
        parser.add_argument("--name", default="Abdelilah Dahou")

    def handle(self, *args, **options):
        primary_email = options["email"]
        primary_password = options["password"]
        primary_name = options["name"]

        # Ensure default active organization exists
        org, _ = Organization.objects.get_or_create(
            name="TeamFlow Workspace",
            defaults={
                "subscription_tier": Organization.Tier.GROWTH,
                "subscription_status": Organization.Status.ACTIVE,
            },
        )

        accounts_to_sync = [
            {
                "email": primary_email,
                "password": primary_password,
                "name": primary_name,
                "role": User.Role.CEO,
            },
            {
                "email": "admin@teamflow.dev",
                "password": primary_password,
                "name": "Platform Super Admin",
                "role": User.Role.ADMIN,
            },
        ]

        for acc in accounts_to_sync:
            email = acc["email"]
            pwd = acc["password"]
            name = acc["name"]
            role = acc["role"]

            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    "name": name,
                    "role": role,
                    "is_staff": True,
                    "is_superuser": True,
                    "organization": org,
                },
            )
            user.is_staff = True
            user.is_superuser = True
            user.role = role
            user.name = name
            user.organization = org
            user.set_password(pwd)
            user.save()
            add_member(user, org, role)

            action = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{action} admin superuser: {email} (Role: {role})"))
