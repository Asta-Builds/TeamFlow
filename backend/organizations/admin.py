from django.contrib import admin

from .models import Organization


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "subscription_tier", "subscription_status", "created_at"]
    list_filter = ["subscription_tier", "subscription_status"]
    search_fields = ["name"]
