from django.db import models


class SEOAudit(models.Model):
    """Result of a technical SEO audit run against a URL/page."""

    url = models.URLField()
    score = models.PositiveSmallIntegerField(default=0, help_text="0-100 overall audit score")
    performance_score = models.PositiveSmallIntegerField(default=90)
    seo_score = models.PositiveSmallIntegerField(default=92)
    mobile_score = models.PositiveSmallIntegerField(default=95)
    load_time_ms = models.PositiveIntegerField(default=350)
    issues = models.JSONField(default=list, blank=True)
    metrics = models.JSONField(default=dict, blank=True)
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="seo_audits",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"SEO audit {self.url} ({self.score})"
