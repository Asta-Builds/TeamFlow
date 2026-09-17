from django.contrib import admin

from .models import Membership, Organization


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "subscription_tier", "subscription_status", "created_at"]
    list_filter = ["subscription_tier", "subscription_status"]
    search_fields = ["name"]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "organization", "role", "status", "created_at"]
    list_filter = ["role", "status"]
    search_fields = ["user__email", "organization__name"]
    raw_id_fields = ["user", "organization", "invited_by"]
