from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from organizations.models import Organization
from projects.models import Project
from tasks.models import Comment, Task
from deployments.models import Deployment
from seo.models import SEOAudit

User = get_user_model()

TEAM = [
    ("ceo@teamflow.dev", "Abdelilah Dahou", User.Role.ADMIN),
    ("lead@teamflow.dev", "Sarah Jenkins (PM)", User.Role.ADMIN),
    ("backend1@teamflow.dev", "Marcus Aurelius", User.Role.MEMBER),
    ("backend2@teamflow.dev", "Julius Caesar", User.Role.MEMBER),
    ("frontend1@teamflow.dev", "Cleopatra Philopator", User.Role.MEMBER),
    ("frontend2@teamflow.dev", "Alexander Great", User.Role.MEMBER),
    ("devops@teamflow.dev", "Joan Arc", User.Role.MEMBER),
    ("qa@teamflow.dev", "Alan Turing", User.Role.MEMBER),
    ("design@teamflow.dev", "Leonardo DaVinci", User.Role.MEMBER),
    ("seo@teamflow.dev", "Ada Lovelace", User.Role.MEMBER),
]

DEMO_PASSWORD = "teamflow-demo-pw"

TASKS = [
    ("Set up JWT auth endpoints", Task.Status.DONE, Task.Priority.HIGH, "backend1@teamflow.dev"),
    ("Build the app shell + sidebar", Task.Status.IN_REVIEW, Task.Priority.HIGH, "frontend1@teamflow.dev"),
    ("Design the Kanban board", Task.Status.IN_PROGRESS, Task.Priority.MEDIUM, "design@teamflow.dev"),
    ("Projects & Tasks API", Task.Status.IN_PROGRESS, Task.Priority.HIGH, "backend2@teamflow.dev"),
    ("CI pipeline on GitHub Actions", Task.Status.TODO, Task.Priority.MEDIUM, "devops@teamflow.dev"),
    ("Write API integration tests", Task.Status.TODO, Task.Priority.MEDIUM, "qa@teamflow.dev"),
    ("Technical SEO audit of landing", Task.Status.TODO, Task.Priority.LOW, "seo@teamflow.dev"),
]


class Command(BaseCommand):
    help = "Seed a demo TeamFlow SaaS workspace."

    @transaction.atomic
    def handle(self, *args, **options):
        # 1. Create or get Organization
        org, _ = Organization.objects.get_or_create(
            name="TeamFlow Workspace",
            defaults={
                "subscription_tier": Organization.Tier.GROWTH,
                "subscription_status": Organization.Status.ACTIVE,
            }
        )

        # 2. Seed Team
        users = {}
        for email, name, role in TEAM:
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    "name": name,
                    "role": role,
                    "organization": org,
                }
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
            else:
                user.organization = org
                user.role = role
                user.save()
            users[email] = user
        self.stdout.write(self.style.SUCCESS(f"Team: {len(users)} users seeded under Organization '{org.name}'"))

        # 3. Seed Projects
        project, _ = Project.objects.get_or_create(
            name="TeamFlow MVP",
            organization=org,
            defaults={
                "description": "Internal project & ticket management platform.",
                "owner": users["lead@teamflow.dev"],
                "status": Project.Status.ACTIVE,
            },
        )
        project.members.set(users.values())

        # 4. Seed Tasks (Tickets)
        for order, (title, status, priority, assignee_email) in enumerate(TASKS):
            task, created = Task.objects.get_or_create(
                project=project,
                title=title,
                organization=org,
                defaults={
                    "status": status,
                    "priority": priority,
                    "assignee": users[assignee_email],
                    "created_by": users["lead@teamflow.dev"],
                    "order": order,
                },
            )
            if created:
                Comment.objects.create(
                    task=task,
                    author=users["lead@teamflow.dev"],
                    body=f"Ticket assigned to {users[assignee_email].name}."
                )

        # 5. Seed Deployment
        Deployment.objects.get_or_create(
            project=project,
            environment=Deployment.Environment.STAGING,
            organization=org,
            defaults={
                "status": Deployment.Status.SUCCESS,
                "commit_sha": "a1b2c3d4",
                "triggered_by": users["devops@teamflow.dev"],
            },
        )

        # 6. Seed SEO Audit
        SEOAudit.objects.get_or_create(
            url="https://teamflow.dev",
            organization=org,
            defaults={
                "score": 92,
                "issues": [
                    {"severity": "medium", "message": "Landing page is missing meta description tag."},
                    {"severity": "low", "message": "1 image asset is missing alt text attribute."}
                ]
            }
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded TeamFlow SaaS Demo workspace successfully. "
                f"Login with any @teamflow.dev email (e.g. lead@teamflow.dev) / password '{DEMO_PASSWORD}'."
            )
        )
