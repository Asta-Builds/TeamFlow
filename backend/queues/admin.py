from django.contrib import admin, messages
from django.utils.html import format_html
from django.urls import path, reverse
from django.shortcuts import redirect, get_object_or_404
from django.http import HttpResponseRedirect

from .models import DeadLetterMessage
from .service import RabbitMQService


@admin.register(DeadLetterMessage)
class DeadLetterMessageAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status_badge",
        "task_name_display",
        "task_id_truncated",
        "queue_name",
        "exception_summary",
        "retry_count",
        "created_at",
        "replay_action_button",
    )
    list_filter = ("status", "queue_name", "created_at", "exception_class")
    search_fields = ("task_id", "task_name", "exception_class", "exception_message")
    readonly_fields = (
        "task_id",
        "task_name",
        "queue_name",
        "routing_key",
        "exchange",
        "retry_count",
        "last_replayed_at",
        "created_at",
        "updated_at",
        "formatted_args",
        "formatted_kwargs",
        "formatted_payload",
        "formatted_traceback",
    )
    fieldsets = (
        (
            "Task Identification",
            {
                "fields": ("status", "task_id", "task_name", "queue_name", "routing_key", "exchange"),
            },
        ),
        (
            "Failure Diagnosis",
            {
                "fields": ("exception_class", "exception_message", "formatted_traceback"),
            },
        ),
        (
            "Payload & Execution Arguments",
            {
                "fields": ("formatted_args", "formatted_kwargs", "formatted_payload"),
                "classes": ("collapse",),
            },
        ),
        (
            "Lifecycle & Retries",
            {
                "fields": ("retry_count", "last_replayed_at", "created_at", "updated_at"),
            },
        ),
    )
    actions = ["replay_selected_messages", "purge_selected_messages", "mark_as_resolved"]

    def status_badge(self, obj):
        colors = {
            DeadLetterMessage.Status.PENDING: ("#d97706", "#fef3c7"),    # amber
            DeadLetterMessage.Status.REPLAYED: ("#059669", "#d1fae5"),   # emerald
            DeadLetterMessage.Status.PURGED: ("#6b7280", "#f3f4f6"),     # slate
            DeadLetterMessage.Status.RESOLVED: ("#2563eb", "#dbeafe"),   # blue
        }
        text_color, bg_color = colors.get(obj.status, ("#4b5563", "#f3f4f6"))
        return format_html(
            '<span style="display:inline-block; padding:3px 8px; font-size:11px; font-weight:600; border-radius:9999px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.get_status_display(),
        )
    status_badge.short_description = "Status"
    status_badge.admin_order_field = "status"

    def task_name_display(self, obj):
        parts = obj.task_name.split(".")
        short_name = parts[-1] if len(parts) > 1 else obj.task_name
        return format_html('<span title="{}" style="font-family:monospace; font-weight:600;">{}</span>', obj.task_name, short_name)
    task_name_display.short_description = "Task"
    task_name_display.admin_order_field = "task_name"

    def task_id_truncated(self, obj):
        short_id = obj.task_id[:12] + "..." if len(obj.task_id) > 12 else obj.task_id
        return format_html('<code style="font-size:11px; color:#64748b;">{}</code>', short_id)
    task_id_truncated.short_description = "Task ID"

    def exception_summary(self, obj):
        msg = (obj.exception_message[:45] + "...") if len(obj.exception_message) > 45 else obj.exception_message
        return format_html('<span title="{}: {}" style="color:#e11d48; font-size:12px;"><strong>{}</strong>: {}</span>', obj.exception_class, obj.exception_message, obj.exception_class, msg)
    exception_summary.short_description = "Exception"

    def replay_action_button(self, obj):
        url = reverse("admin:queues_deadlettermessage_replay_single", args=[obj.pk])
        return format_html(
            '<a href="{}" style="display:inline-block; padding:4px 10px; font-size:11px; font-weight:600; background:#2563eb; color:#fff; border-radius:4px; text-decoration:none;">Replay</a>',
            url,
        )
    replay_action_button.short_description = "Action"

    def formatted_args(self, obj):
        import json
        return format_html('<pre style="background:#1e293b; color:#e2e8f0; padding:10px; border-radius:6px; font-size:12px;">{}</pre>', json.dumps(obj.args, indent=2))
    formatted_args.short_description = "Positional Arguments"

    def formatted_kwargs(self, obj):
        import json
        return format_html('<pre style="background:#1e293b; color:#e2e8f0; padding:10px; border-radius:6px; font-size:12px;">{}</pre>', json.dumps(obj.kwargs, indent=2))
    formatted_kwargs.short_description = "Keyword Arguments"

    def formatted_payload(self, obj):
        import json
        return format_html('<pre style="background:#1e293b; color:#e2e8f0; padding:10px; border-radius:6px; font-size:12px;">{}</pre>', json.dumps(obj.payload, indent=2))
    formatted_payload.short_description = "Payload"

    def formatted_traceback(self, obj):
        if not obj.traceback:
            return "No traceback recorded."
        return format_html('<pre style="background:#0f172a; color:#f87171; padding:12px; border-radius:6px; font-size:11px; max-height:350px; overflow-y:auto; font-family:Consolas,monospace;">{}</pre>', obj.traceback)
    formatted_traceback.short_description = "Execution Traceback"

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path("<int:pk>/replay/", self.admin_site.admin_view(self.replay_single_view), name="queues_deadlettermessage_replay_single"),
            path("replay-all-pending/", self.admin_site.admin_view(self.replay_all_view), name="queues_deadlettermessage_replay_all"),
            path("purge-all-pending/", self.admin_site.admin_view(self.purge_all_view), name="queues_deadlettermessage_purge_all"),
        ]
        return custom_urls + urls

    def replay_single_view(self, request, pk):
        res = RabbitMQService.replay_message(pk)
        if res.get("success"):
            self.message_user(request, f"Successfully replayed dead letter #{pk} into queue '{res.get('queue')}'.", messages.SUCCESS)
        else:
            self.message_user(request, f"Failed to replay message #{pk}: {res.get('error')}", messages.ERROR)
        return redirect("admin:queues_deadlettermessage_changelist")

    def replay_all_view(self, request):
        res = RabbitMQService.replay_all_pending()
        self.message_user(
            request,
            f"Batch replay executed: {res.get('replayed_count')}/{res.get('total_pending')} pending messages replayed into RabbitMQ.",
            messages.SUCCESS if not res.get("errors") else messages.WARNING,
        )
        return redirect("admin:queues_deadlettermessage_changelist")

    def purge_all_view(self, request):
        res = RabbitMQService.purge_dlq()
        self.message_user(
            request,
            f"DLQ purged: {res.get('db_records_purged')} database records marked as purged. AMQP queue cleared.",
            messages.INFO,
        )
        return redirect("admin:queues_deadlettermessage_changelist")

    @admin.action(description="Replay selected dead letter messages into RabbitMQ")
    def replay_selected_messages(self, request, queryset):
        replayed = 0
        for obj in queryset:
            res = RabbitMQService.replay_message(obj.id)
            if res.get("success"):
                replayed += 1
        self.message_user(request, f"{replayed} selected dead letter messages re-enqueued for execution.", messages.SUCCESS)

    @admin.action(description="Purge selected messages (mark as discarded)")
    def purge_selected_messages(self, request, queryset):
        count = queryset.update(status=DeadLetterMessage.Status.PURGED)
        self.message_user(request, f"{count} selected messages marked as purged.", messages.INFO)

    @admin.action(description="Mark selected messages as Resolved")
    def mark_as_resolved(self, request, queryset):
        count = queryset.update(status=DeadLetterMessage.Status.RESOLVED)
        self.message_user(request, f"{count} messages marked as resolved.", messages.SUCCESS)
