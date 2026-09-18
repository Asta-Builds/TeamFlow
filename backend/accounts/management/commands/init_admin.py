import os
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

User = get_user_model()


class Command(BaseCommand):
    help = "Creates or updates the primary platform superuser/admin account."

    def add_arguments(self, parser):
        parser.add_argument("--email", default=os.getenv("DJANGO_SUPERUSER_EMAIL", "admin@teamflow.dev"))
        parser.add_argument("--password", default=os.getenv("DJANGO_SUPERUSER_PASSWORD", "AdminPassword123!"))
        parser.add_argument("--name", default="Super Admin")

    def handle(self, *args, **options):
        email = options["email"]
        password = options["password"]
        name = options["name"]

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "name": name,
                "role": User.Role.ADMIN,
                "is_staff": True,
                "is_superuser": True,
            },
        )
        user.is_staff = True
        user.is_superuser = True
        user.role = User.Role.ADMIN
        user.set_password(password)
        user.save()

        action = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{action} admin superuser: {email}"))
