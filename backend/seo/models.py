from django.db import models


class SEOAudit(models.Model):
    """Result of a technical SEO audit run against a URL/page."""

    url = models.URLField()
    score = models.PositiveSmallIntegerField(default=0, help_text="0-100 audit score")
    issues = models.JSONField(default=list, blank=True)
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
