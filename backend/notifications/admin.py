from django.contrib import admin
from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["title", "recipient", "actor", "is_read", "organization", "created_at"]
    list_filter = ["is_read", "created_at", "organization"]
    search_fields = ["title", "message", "recipient__email"]
    raw_id_fields = ["recipient", "actor", "organization"]
