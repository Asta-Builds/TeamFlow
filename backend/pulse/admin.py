from django.contrib import admin

from .models import PulseFocusSession, PulseNote, PulsePlanItem


@admin.register(PulsePlanItem)
class PulsePlanItemAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "time_block", "task", "position")
    list_filter = ("time_block", "date")
    search_fields = ("user__email", "task__title")


@admin.register(PulseNote)
class PulseNoteAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "updated_at")
    search_fields = ("user__email", "body")


@admin.register(PulseFocusSession)
class PulseFocusSessionAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "plan_item", "started_at", "elapsed_seconds")
    list_filter = ("status",)
    search_fields = ("user__email", "plan_item__task__title")
