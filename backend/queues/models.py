from django.db import models


class DeadLetterMessage(models.Model):
    """
    Persistent Dead Letter Queue (DLQ) record.
    Captures failed, poison, or rejected messages from RabbitMQ and Celery
    for administrative inspection, audit logging, and manual/automated replay.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending Review"
        REPLAYED = "replayed", "Replayed / Requeued"
        PURGED = "purged", "Purged / Discarded"
        RESOLVED = "resolved", "Resolved"

    task_id = models.CharField(max_length=255, db_index=True, help_text="Celery task UUID or RabbitMQ message ID")
    task_name = models.CharField(max_length=255, db_index=True, help_text="Python task path or message type")
    queue_name = models.CharField(max_length=100, default="teamflow.tasks", db_index=True)
    routing_key = models.CharField(max_length=100, default="tasks", blank=True)
    exchange = models.CharField(max_length=100, default="teamflow", blank=True)
    payload = models.JSONField(default=dict, blank=True, help_text="Raw payload or serialized message body")
    args = models.JSONField(default=list, blank=True, help_text="Positional arguments passed to task")
    kwargs = models.JSONField(default=dict, blank=True, help_text="Keyword arguments passed to task")
    exception_class = models.CharField(max_length=255, blank=True)
    exception_message = models.TextField(blank=True)
    traceback = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    retry_count = models.PositiveIntegerField(default=0)
    last_replayed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Dead Letter Message"
        verbose_name_plural = "Dead Letter Queue (DLQ)"
        indexes = [
            models.Index(fields=["status", "-created_at"], name="dlq_status_created_idx"),
            models.Index(fields=["queue_name", "status"], name="dlq_queue_status_idx"),
        ]

    def __str__(self):
        return f"DLQ [{self.status}] {self.task_name} ({self.task_id[:8]}...)"
