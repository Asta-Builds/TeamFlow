from django.contrib import admin
from django.utils.html import format_html

from .models import Membership, Organization


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "tier_badge", "status_badge", "created_at"]
    list_filter = ["subscription_tier", "subscription_status", "created_at"]
    search_fields = ["name"]
    readonly_fields = ["created_at"]

    def tier_badge(self, obj):
        colors = {
            "ENTERPRISE": ("#8b5cf6", "rgba(139, 92, 246, 0.15)"),
            "GROWTH": ("#10b981", "rgba(16, 185, 129, 0.15)"),
            "FREE": ("#6b7280", "rgba(107, 114, 128, 0.15)"),
        }
        text_color, bg_color = colors.get(str(obj.subscription_tier).upper(), ("#94a3b8", "rgba(255, 255, 255, 0.05)"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:11px; font-weight:700; '
            'border-radius:4px; background-color:{}; color:{}; text-transform:uppercase;">{}</span>',
            bg_color,
            text_color,
            obj.subscription_tier,
        )
    tier_badge.short_description = "Tier"
    tier_badge.admin_order_field = "subscription_tier"

    def status_badge(self, obj):
        status_str = str(obj.subscription_status).upper()
        if status_str in ["ACTIVE", "TRIALING"]:
            return format_html(
                '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:600; '
                'border-radius:9999px; background:rgba(16, 185, 129, 0.15); color:#10b981; text-transform:uppercase;">Active</span>'
            )
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:600; '
            'border-radius:9999px; background:rgba(239, 68, 68, 0.15); color:#ef4444; text-transform:uppercase;">{}</span>',
            obj.subscription_status,
        )
    status_badge.short_description = "Status"
    status_badge.admin_order_field = "subscription_status"


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "organization", "role", "status", "created_at"]
    list_filter = ["role", "status", "created_at"]
    search_fields = ["user__email", "organization__name"]
    raw_id_fields = ["user", "organization", "invited_by"]
    readonly_fields = ["created_at", "updated_at"]
