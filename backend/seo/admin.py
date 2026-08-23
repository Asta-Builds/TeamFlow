from django.contrib import admin

from .models import SEOAudit


@admin.register(SEOAudit)
class SEOAuditAdmin(admin.ModelAdmin):
    list_display = ["url", "score", "organization", "created_at"]
    list_filter = ["organization"]
    search_fields = ["url"]
