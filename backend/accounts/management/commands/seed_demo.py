from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from organizations.membership import add_member
from organizations.models import Organization
from projects.models import Project
from tasks.models import Comment, Task, TaskActivity
from deployments.models import Deployment
from seo.models import SEOAudit
from notifications.models import Notification

User = get_user_model()

import os
import secrets

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD") or secrets.token_urlsafe(16)


class Command(BaseCommand):
    help = "Seed a demo TeamFlow SaaS workspace according to full functional specifications."

    @transaction.atomic
    def handle(self, *args, **options):
        owner_email = os.environ.get("DEMO_OWNER_EMAIL", "owner@example.com")
        owner_name = os.environ.get("DEMO_OWNER_NAME", "Demo Owner")
        site_url = os.environ.get("DEMO_SITE_URL", "https://example.com")

        # 1. Create or get Organization
        org, _ = Organization.objects.get_or_create(
            name="TeamFlow Workspace",
            defaults={
                "subscription_tier": Organization.Tier.GROWTH,
                "subscription_status": Organization.Status.ACTIVE,
            }
        )

        users = {}
        # 2. Seed Human Owner
        user, created = User.objects.get_or_create(
            email=owner_email,
            defaults={
                "name": owner_name,
                "role": User.Role.CEO,
                "bio": "Human Founder & Executive Leader",
                "organization": org,
                "user_status": User.Status.ACTIVE,
            }
        )
        user.organization = org
        user.role = User.Role.CEO
        user.bio = "Human Founder & Executive Leader"
        user.user_status = User.Status.ACTIVE
        if created or not user.has_usable_password():
            user.set_password(DEMO_PASSWORD)
        user.save()
        add_member(user, org, User.Role.CEO)
        users[owner_email] = user

        # Seed Agent Seats
        from agents.registry import AGENT_SEATS
        from agents.users import get_or_create_agent_user
        
        for key in AGENT_SEATS.keys():
            agent_user = get_or_create_agent_user(key, org)
            users[key] = agent_user
            
        self.stdout.write(self.style.SUCCESS(f"Team: {len(users)} users seeded under Organization '{org.name}'"))

        # 3. Seed Projects
        project, _ = Project.objects.get_or_create(
            name="TeamFlow MVP",
            organization=org,
            defaults={
                "description": "Internal project & ticket management platform (Virtual Tech Company).",
                "owner": users["tech_lead"],
                "status": Project.Status.ACTIVE,
            },
        )
        project.members.set(users.values())

        # 4. Seed Tasks (Tickets)
        TASKS = [
            ("Set up JWT auth endpoints", Task.Status.DONE, Task.Type.FEATURE, Task.Priority.HIGH, "backend_core"),
            ("Build the app shell + sidebar", Task.Status.IN_REVIEW, Task.Type.FEATURE, Task.Priority.HIGH, "frontend_app"),
            ("Automated End-to-End Test Suite", Task.Status.QA, Task.Type.TASK, Task.Priority.HIGH, "qa"),
            ("Design the Kanban board & Ticket Modal", Task.Status.IN_PROGRESS, Task.Type.FEATURE, Task.Priority.MEDIUM, "designer"),
            ("Projects & Tasks API endpoints", Task.Status.IN_PROGRESS, Task.Type.FEATURE, Task.Priority.HIGH, "backend_integrations"),
            ("Fix token refresh race condition", Task.Status.TODO, Task.Type.BUG, Task.Priority.URGENT, "backend_core"),
            ("CI pipeline on GitHub Actions", Task.Status.TODO, Task.Type.TASK, Task.Priority.MEDIUM, "devops"),
            ("Technical SEO audit of landing page", Task.Status.TODO, Task.Type.TASK, Task.Priority.LOW, "seo"),
        ]
        
        for order, (title, status, task_type, priority, assignee_key) in enumerate(TASKS):
            task, created = Task.objects.get_or_create(
                project=project,
                title=title,
                organization=org,
                defaults={
                    "status": status,
                    "task_type": task_type,
                    "priority": priority,
                    "assignee": users[assignee_key],
                    "created_by": users["tech_lead"],
                    "order": order,
                    "pr_url": "",
                },
            )
            if created:
                Comment.objects.create(
                    task=task,
                    author=users["tech_lead"],
                    body=f"Ticket assigned to {users[assignee_key].name}."
                )
                TaskActivity.objects.create(
                    task=task,
                    actor=users["tech_lead"],
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
                "triggered_by": users["devops"],
                "duration_seconds": 45,
                "logs": "=== Staging Deployment Pipeline ===\n[INFO] Tests passed: 100%\n[INFO] Docker image built successfully.\n[INFO] Staging environment healthy.",
            },
        )

        # 6. Seed SEO Audit
        if not SEOAudit.objects.filter(url=site_url, organization=org).exists():
            SEOAudit.objects.create(
                url=site_url,
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
                    "response_time_ms": 320,
                    "canonical_detected": True,
                    "robots_txt_present": True,
                    "sitemap_present": True,
                    "measured_with": "http_fetch",
                }
            )

        # 7. Seed sample Notifications
        Notification.objects.get_or_create(
            recipient=users["tech_lead"],
            title="Ticket ready for QA: Automated End-to-End Test Suite",
            organization=org,
            defaults={
                "actor": users["qa"],
                "message": f"{users['qa'].name} moved Automated End-to-End Test Suite to QA.",
                "link": f"/projects/{project.id}",
                "is_read": False,
            }
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded TeamFlow SaaS Demo workspace successfully. "
                f"Sign in as {owner_email} with password '{DEMO_PASSWORD}'. AI agent seats cannot sign in."
            )
        )
