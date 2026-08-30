from django.conf import settings
from django.db import models


class PulsePlanItem(models.Model):
    """A private slot in a user's daily execution plan for an existing task."""

    class TimeBlock(models.TextChoices):
        MORNING = "morning", "Morning"
        AFTERNOON = "afternoon", "Afternoon"
        EVENING = "evening", "Evening"

    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="pulse_plan_items",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pulse_plan_items",
    )
    task = models.ForeignKey(
        "tasks.Task",
        on_delete=models.CASCADE,
        related_name="pulse_plan_items",
    )
    date = models.DateField()
    time_block = models.CharField(
        max_length=12,
        choices=TimeBlock.choices,
        default=TimeBlock.MORNING,
    )
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "time_block", "position", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "date", "task"],
                name="pulse_unique_daily_task_per_user",
            )
        ]
        indexes = [
            models.Index(fields=["organization", "user", "date"]),
        ]

    def __str__(self):
        return f"{self.user} · {self.date} · {self.task}"


class PulseNote(models.Model):
    """A user's private daily scratchpad; it is never shared with the workspace."""

    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="pulse_notes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pulse_notes",
    )
    date = models.DateField()
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "date"],
                name="pulse_unique_daily_note_per_user",
            )
        ]
        indexes = [
            models.Index(fields=["organization", "user", "date"]),
        ]

    def __str__(self):
        return f"{self.user} · note for {self.date}"


class PulseFocusSession(models.Model):
    """A durable personal focus timer, optionally connected to a planned task."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"

    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="pulse_focus_sessions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pulse_focus_sessions",
    )
    plan_item = models.ForeignKey(
        PulsePlanItem,
        on_delete=models.SET_NULL,
        related_name="focus_sessions",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=12,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    started_at = models.DateTimeField()
    last_resumed_at = models.DateTimeField(null=True, blank=True)
    elapsed_seconds = models.PositiveIntegerField(default=0)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["organization", "user", "status"]),
            models.Index(fields=["organization", "user", "started_at"]),
        ]

    def __str__(self):
        return f"{self.user} · {self.status} focus session"
