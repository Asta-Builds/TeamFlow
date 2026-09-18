from django.db import models
import uuid


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


from django.core.serializers.json import DjangoJSONEncoder


class OutboxMessage(models.Model):
    """
    Transactional Outbox record.
    Guarantees at-least-once asynchronous event publishing to RabbitMQ / Celery
    without dual-write inconsistencies during database transactions.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending Dispatch"
        PUBLISHED = "published", "Published"
        FAILED = "failed", "Failed"

    event_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    event_type = models.CharField(max_length=100, db_index=True, help_text="Domain event class or topic")
    exchange = models.CharField(max_length=100, default="teamflow.events", help_text="AMQP topic exchange")
    routing_key = models.CharField(max_length=100, default="events", help_text="AMQP routing key")
    payload = models.JSONField(default=dict, encoder=DjangoJSONEncoder, help_text="Serialized domain event payload")
    headers = models.JSONField(default=dict, encoder=DjangoJSONEncoder, blank=True, help_text="Message headers (tracing IDs, metadata)")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    retry_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Outbox Message"
        verbose_name_plural = "Transactional Outbox"
        indexes = [
            models.Index(fields=["status", "created_at"], name="outbox_status_created_idx"),
            models.Index(fields=["event_type", "status"], name="outbox_event_status_idx"),
        ]

    def __str__(self):
        return f"Outbox [{self.status}] {self.event_type} ({str(self.event_id)[:8]}...)"

