from django.contrib import admin

from .models import Deployment


@admin.register(Deployment)
class DeploymentAdmin(admin.ModelAdmin):
    list_display = ["organization", "project", "environment", "status", "triggered_by", "started_at"]
    list_filter = ["environment", "status", "organization"]
