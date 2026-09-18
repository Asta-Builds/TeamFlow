from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "name", "role_badge", "staff_status_badge", "is_active", "date_joined"]
    list_filter = ["role", "is_staff", "is_superuser", "is_active", "date_joined"]
    search_fields = ["email", "name"]
    readonly_fields = ["last_login", "date_joined"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("name", "role", "avatar_url")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "name", "role", "password1", "password2"),
            },
        ),
    )

    def role_badge(self, obj):
        colors = {
            "CEO": ("#d97706", "#fef3c7"),
            "TECH_LEAD": ("#7c3aed", "#ede9fe"),
            "PM": ("#2563eb", "#dbeafe"),
            "BACKEND_DEV": ("#0284c7", "#e0f2fe"),
            "FRONTEND_DEV": ("#0d9488", "#ccfbf1"),
            "QA": ("#059669", "#d1fae5"),
            "DEVOPS": ("#ea580c", "#ffedd5"),
            "DESIGNER": ("#db2777", "#fce7f3"),
            "SEO": ("#16a34a", "#dcfce7"),
        }
        text_color, bg_color = colors.get(obj.role, ("#4b5563", "#f3f4f6"))
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:11px; font-weight:600; '
            'border-radius:9999px; background-color:{}; color:{}; text-transform:uppercase; '
            'font-family:ui-monospace, monospace;">{}</span>',
            bg_color,
            text_color,
            obj.get_role_display() if hasattr(obj, "get_role_display") else obj.role,
        )
    role_badge.short_description = "Role"
    role_badge.admin_order_field = "role"

    def staff_status_badge(self, obj):
        if obj.is_superuser:
            return format_html(
                '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:700; '
                'border-radius:4px; background:#ef4444; color:#fff; text-transform:uppercase;">Superuser</span>'
            )
        if obj.is_staff:
            return format_html(
                '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:600; '
                'border-radius:4px; background:#3b82f6; color:#fff; text-transform:uppercase;">Staff</span>'
            )
        return format_html(
            '<span style="display:inline-block; padding:2px 8px; font-size:10px; font-weight:500; '
            'border-radius:4px; background:rgba(255,255,255,0.06); color:#94a3b8;">User</span>'
        )
    staff_status_badge.short_description = "Access Tier"
