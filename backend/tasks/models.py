from django.conf import settings
from django.db import models


class Task(models.Model):
    """A ticket on the shared task board (the Kanban card)."""

    class Status(models.TextChoices):
        TODO = "todo", "To Do"
        IN_PROGRESS = "in_progress", "In Progress"
        IN_REVIEW = "in_review", "In Review"
        QA = "qa", "QA / Ready for Test"
        DONE = "done", "Done"

    class Type(models.TextChoices):
        FEATURE = "feature", "Feature"
        BUG = "bug", "Bug"
        TASK = "task", "Task"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        URGENT = "urgent", "Critical"

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="tasks",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    task_type = models.CharField(max_length=20, choices=Type.choices, default=Type.TASK)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tasks",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_tasks",
    )
    due_date = models.DateField(null=True, blank=True)
    pr_url = models.URLField(blank=True, help_text="Linked GitHub Pull Request URL")
    qa_rejected = models.BooleanField(default=False)
    qa_rejection_reason = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0, help_text="Position within its board column")
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="tasks",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "-created_at"]

    def __str__(self):
        return self.title


class Comment(models.Model):
    """A status update / comment thread entry on a ticket."""

    task = models.ForeignKey("tasks.Task", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="comments",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment by {self.author} on {self.task}"


class TaskActivity(models.Model):
    """Audit log tracking history of changes on a task / ticket."""

    task = models.ForeignKey("tasks.Task", on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="task_activities",
    )
    action = models.CharField(max_length=50) # created, status_changed, assigned, qa_validated, qa_rejected, commented
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.actor} {self.action} on {self.task} at {self.created_at}"
