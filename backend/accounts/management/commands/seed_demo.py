from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from organizations.models import Organization
from projects.models import Project
from tasks.models import Comment, Task, TaskActivity
from deployments.models import Deployment
from seo.models import SEOAudit
from notifications.models import Notification

User = get_user_model()

TEAM = [
    ("ceo@teamflow.dev", "Abdelilah Dahou", User.Role.CEO, "Human Founder & Executive Leader"),
    ("pm@teamflow.dev", "Athena (AI)", User.Role.PM, "Autonomous AI Product Manager & Roadmap Architect"),
    ("lead@teamflow.dev", "Sarah Jenkins (AI)", User.Role.TECH_LEAD, "Autonomous AI Tech Lead & Swarm Orchestrator"),
    ("backend1@teamflow.dev", "Marcus Aurelius (AI)", User.Role.BACKEND, "Autonomous AI Senior Backend Engineer"),
    ("backend2@teamflow.dev", "Julius Caesar (AI)", User.Role.BACKEND, "Autonomous AI Senior Backend Engineer"),
    ("frontend1@teamflow.dev", "Cleopatra (AI)", User.Role.FRONTEND, "Autonomous AI Senior Frontend Engineer"),
    ("frontend2@teamflow.dev", "Alexander (AI)", User.Role.FRONTEND, "Autonomous AI Senior Frontend Engineer"),
    ("devops@teamflow.dev", "Joan of Arc (AI)", User.Role.DEVOPS, "Autonomous AI DevOps & Release Engineer"),
    ("qa@teamflow.dev", "Alan Turing (AI)", User.Role.QA, "Autonomous AI QA & Gatekeeper Engineer"),
    ("design@teamflow.dev", "Leonardo Da Vinci (AI)", User.Role.DESIGNER, "Autonomous AI UI/UX Design Specialist"),
    ("seo@teamflow.dev", "Ada Lovelace (AI)", User.Role.SEO, "Autonomous AI Technical SEO Specialist"),
]

DEMO_PASSWORD = "teamflow-demo-pw"

TASKS = [
    ("Set up JWT auth endpoints", Task.Status.DONE, Task.Type.FEATURE, Task.Priority.HIGH, "backend1@teamflow.dev"),
    ("Build the app shell + sidebar", Task.Status.IN_REVIEW, Task.Type.FEATURE, Task.Priority.HIGH, "frontend1@teamflow.dev"),
    ("Automated End-to-End Test Suite", Task.Status.QA, Task.Type.TASK, Task.Priority.HIGH, "qa@teamflow.dev"),
    ("Design the Kanban board & Ticket Modal", Task.Status.IN_PROGRESS, Task.Type.FEATURE, Task.Priority.MEDIUM, "design@teamflow.dev"),
    ("Projects & Tasks API endpoints", Task.Status.IN_PROGRESS, Task.Type.FEATURE, Task.Priority.HIGH, "backend2@teamflow.dev"),
    ("Fix token refresh race condition", Task.Status.TODO, Task.Type.BUG, Task.Priority.URGENT, "backend1@teamflow.dev"),
    ("CI pipeline on GitHub Actions", Task.Status.TODO, Task.Type.TASK, Task.Priority.MEDIUM, "devops@teamflow.dev"),
    ("Technical SEO audit of landing page", Task.Status.TODO, Task.Type.TASK, Task.Priority.LOW, "seo@teamflow.dev"),
]


class Command(BaseCommand):
    help = "Seed a demo TeamFlow SaaS workspace according to full functional specifications."

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
        for email, name, role, bio in TEAM:
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    "name": name,
                    "role": role,
                    "bio": bio,
                    "organization": org,
                    "user_status": User.Status.ACTIVE,
                }
            )
            user.organization = org
            user.role = role
            user.bio = bio
            user.user_status = User.Status.ACTIVE
            if created or not user.has_usable_password():
                user.set_password(DEMO_PASSWORD)
            user.save()
            users[email] = user
        self.stdout.write(self.style.SUCCESS(f"Team: {len(users)} users seeded under Organization '{org.name}'"))

        # 3. Seed Projects
        project, _ = Project.objects.get_or_create(
            name="TeamFlow MVP",
            organization=org,
            defaults={
                "description": "Internal project & ticket management platform (Virtual Tech Company).",
                "owner": users["lead@teamflow.dev"],
                "status": Project.Status.ACTIVE,
            },
        )
        project.members.set(users.values())

        # 4. Seed Tasks (Tickets)
        for order, (title, status, task_type, priority, assignee_email) in enumerate(TASKS):
            task, created = Task.objects.get_or_create(
                project=project,
                title=title,
                organization=org,
                defaults={
                    "status": status,
                    "task_type": task_type,
                    "priority": priority,
                    "assignee": users[assignee_email],
                    "created_by": users["lead@teamflow.dev"],
                    "order": order,
                    "pr_url": "https://github.com/teamflow/teamflow/pull/42" if status in {Task.Status.IN_REVIEW, Task.Status.QA, Task.Status.DONE} else "",
                },
            )
            if created:
                Comment.objects.create(
                    task=task,
                    author=users["lead@teamflow.dev"],
                    body=f"Ticket assigned to {users[assignee_email].name}."
                )
                TaskActivity.objects.create(
                    task=task,
                    actor=users["lead@teamflow.dev"],
                    action="created",
                    details={"title": title, "status": status}
                )

        # 5. Seed Deployment
        Deployment.objects.get_or_create(
            project=project,
            environment=Deployment.Environment.STAGING,
            organization=org,
            defaults={
                "status": Deployment.Status.SUCCESS,
                "commit_sha": "a1b2c3d4",
                "branch": "main",
                "triggered_by": users["devops@teamflow.dev"],
                "duration_seconds": 45,
                "logs": "=== Staging Deployment Pipeline ===\n[INFO] Tests passed: 100%\n[INFO] Docker image built successfully.\n[INFO] Staging environment healthy.",
            },
        )

        # 6. Seed SEO Audit
        if not SEOAudit.objects.filter(url="https://teamflow.dev", organization=org).exists():
            SEOAudit.objects.create(
                url="https://teamflow.dev",
                organization=org,
                score=92,
                performance_score=94,
                seo_score=92,
                mobile_score=95,
                load_time_ms=320,
                issues=[
                    {
                        "severity": "medium",
                        "category": "metadata",
                        "message": "Landing page is missing meta description tag.",
                        "recommendation": "Add descriptive meta tag in document head."
                    },
                    {
                        "severity": "low",
                        "category": "accessibility",
                        "message": "1 image asset is missing alt text attribute.",
                        "recommendation": "Provide alt text for all visual assets."
                    }
                ],
                metrics={
                    "fcp_ms": 780,
                    "lcp_ms": 1420,
                    "cls": 0.02,
                    "fid_ms": 18,
                    "canonical_detected": True,
                }
            )

        # 7. Seed sample Notifications
        Notification.objects.get_or_create(
            recipient=users["lead@teamflow.dev"],
            title="Ticket ready for QA: Automated End-to-End Test Suite",
            organization=org,
            defaults={
                "actor": users["qa@teamflow.dev"],
                "message": "Alan Turing moved Automated End-to-End Test Suite to QA.",
                "link": f"/projects/{project.id}",
                "is_read": False,
            }
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded TeamFlow SaaS Demo workspace successfully. "
                f"Login with any @teamflow.dev email (e.g. lead@teamflow.dev, ceo@teamflow.dev) / password '{DEMO_PASSWORD}'."
            )
        )
