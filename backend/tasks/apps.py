from django.apps import AppConfig


class TasksConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tasks"

    def ready(self):
        # Register domain event subscribers on application startup
        from tasks.domain.bus import default_event_bus
        from tasks.domain.subscribers import register_domain_subscribers

        register_domain_subscribers(default_event_bus)
