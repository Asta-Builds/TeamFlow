from django.conf import settings
from django.db import models


class Deployment(models.Model):
    """A record of a release/deploy, owned by the DevOps flow and isolated by tenant."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        IN_PROGRESS = "in_progress", "In Progress"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        ROLLED_BACK = "rolled_back", "Rolled Back"
        CANCELLED = "cancelled", "Cancelled"

    class Environment(models.TextChoices):
        DEV = "dev", "Development"
        STAGING = "staging", "Staging"
        PRODUCTION = "production", "Production"

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="deployments",
    )
    environment = models.CharField(
        max_length=20, choices=Environment.choices, default=Environment.STAGING
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)
    commit_sha = models.CharField(max_length=40, blank=True)
    branch = models.CharField(max_length=100, default="main", blank=True)
    logs = models.TextField(blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="deployments",
    )
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="deployments",
        null=True,
        blank=True,
    )
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.project} → {self.environment} ({self.status})"
