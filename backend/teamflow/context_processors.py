from django.conf import settings


def teamflow_context(request):
    """Context processor providing TeamFlow global variables to templates."""
    frontend_url = getattr(settings, "FRONTEND_URL", "")
    if not frontend_url:
        cors_origins = getattr(settings, "CORS_ALLOWED_ORIGINS", [])
        if cors_origins and len(cors_origins) > 0:
            frontend_url = cors_origins[0]
        else:
            frontend_url = "http://localhost:3000"
    return {
        "FRONTEND_URL": frontend_url,
    }
