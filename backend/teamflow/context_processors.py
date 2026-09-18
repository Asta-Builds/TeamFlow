from django.conf import settings


def teamflow_context(request):
    """Context processor providing TeamFlow global variables to templates."""
    frontend_url = getattr(settings, "FRONTEND_URL", "")
    if not frontend_url:
        cors_origins = getattr(settings, "CORS_ALLOWED_ORIGINS", [])
        # Prefer public production domain if available
        for origin in cors_origins:
            if origin and not origin.startswith("http://localhost") and not origin.startswith("http://127.0.0.1"):
                frontend_url = origin
                break
        if not frontend_url and cors_origins:
            frontend_url = cors_origins[0]
        if not frontend_url:
            frontend_url = (
                "https://teamflow-frontend-production-817e.up.railway.app"
                if not getattr(settings, "DEBUG", True)
                else "http://localhost:3000"
            )
    return {
        "FRONTEND_URL": frontend_url,
    }
