from django.apps import AppConfig


class QueuesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "queues"
    verbose_name = "Message Queues & DLQ"

    def ready(self):
        # Register Celery task failure signals
        try:
            import queues.signals  # noqa: F401
        except ImportError:
            pass
