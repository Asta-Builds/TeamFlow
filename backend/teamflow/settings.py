"""
Django settings for the TeamFlow project & ticket management platform.
See the Virtual Tech Company Blueprint for architecture context.
"""

import os
import sys
import secrets
import tempfile
from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
TESTING = "test" in sys.argv

env = environ.Env(
    DEBUG=(bool, False),
    SECRET_KEY=(str, ""),
    ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
    DATABASE_URL=(str, ""),
    CELERY_BROKER_URL=(str, ""),
    KEYCLOAK_URL=(str, ""),
    KEYCLOAK_ISSUER_URL=(str, ""),
    KEYCLOAK_CLIENT_ID=(str, ""),
    KEYCLOAK_CLIENT_SECRET=(str, ""),
    KEYCLOAK_HTTP_TIMEOUT_SECONDS=(int, 5),
    SLACK_SIGNING_SECRET=(str, ""),
    STRIPE_SECRET_KEY=(str, ""),
    STRIPE_WEBHOOK_SECRET=(str, ""),
    STRIPE_PRICE_GROWTH=(str, ""),
    STRIPE_PRICE_ENTERPRISE=(str, ""),
    AGENT_EMAIL_DOMAIN=(str, ""),
)

if TESTING:
    # Tests are hermetic: no developer .env, no GitHub credentials, and agent
    # workspaces live in a throwaway directory instead of the real checkout.
    for _credential in ("GITHUB_TOKEN", "GH_TOKEN", "GITHUB_ORG"):
        os.environ.pop(_credential, None)
    os.environ.setdefault("WORKSPACE_ROOT", tempfile.mkdtemp(prefix="teamflow-test-workspace-"))
    os.environ.setdefault("GIT_AUTHOR_NAME", "TeamFlow Test Agent")
    os.environ.setdefault("GIT_AUTHOR_EMAIL", "agents@example.invalid")
elif (BASE_DIR / ".env").exists():
    environ.Env.read_env(BASE_DIR / ".env")
else:
    environ.Env.read_env(BASE_DIR.parent / ".env")

SECRET_KEY = env("SECRET_KEY", default="") or env("DJANGO_SECRET_KEY", default="")
if not SECRET_KEY:
    if TESTING:
        SECRET_KEY = secrets.token_urlsafe(64)
    else:
        raise ImproperlyConfigured("SECRET_KEY must be configured outside the test suite.")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# Reverse proxy SSL header support
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if not DEBUG:
    # TLS terminates at the public proxy; cookies and browsers must stay on HTTPS.
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
    SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=False)
    # Internal health probes use plain HTTP, so redirects stay opt-in.
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
    X_FRAME_OPTIONS = "DENY"


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # Local apps
    "organizations",
    "accounts",
    "projects",
    "tasks",
    "deployments",
    "seo",
    "notifications",
    "agents",
    "integrations",
    "pulse",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "teamflow.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "teamflow.wsgi.application"


# Database — Postgres via DATABASE_URL in prod/Docker, SQLite only when DATABASE_URL is unset.
db_url = env("DATABASE_URL", default="")
if db_url and "@db:" in db_url and DEBUG and not TESTING:
    # Local convenience: the root .env targets the Compose "db" host. When Django runs on the
    # host machine instead, reach the published Postgres port. Never falls back to SQLite.
    import socket

    try:
        socket.gethostbyname("db")
    except OSError:
        db_url = db_url.replace("@db:", "@localhost:")

if db_url:
    DATABASES = {"default": env.db_url_config(db_url)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "TeamFlow API",
    "DESCRIPTION": "Internal project & ticket management platform.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# Static files serving with WhiteNoise
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Celery Configuration
CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = env("CELERY_BROKER_URL")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

# Keycloak uses a back-channel URL for token exchange/JWKS and a public issuer
# Keycloak uses a back-channel URL for token exchange/JWKS and a public issuer
# URL matching the token's ``iss`` claim.
KEYCLOAK_URL = env("KEYCLOAK_URL").rstrip("/")
KEYCLOAK_ISSUER_URL = env("KEYCLOAK_ISSUER_URL").rstrip("/")
KEYCLOAK_CLIENT_ID = env("KEYCLOAK_CLIENT_ID")
KEYCLOAK_CLIENT_SECRET = env("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_HTTP_TIMEOUT_SECONDS = env("KEYCLOAK_HTTP_TIMEOUT_SECONDS")
KEYCLOAK_TOKEN_URL = f"{KEYCLOAK_URL}/protocol/openid-connect/token"
KEYCLOAK_JWKS_URL = f"{KEYCLOAK_URL}/protocol/openid-connect/certs"

# CORS — allow the Next.js frontend during development and production.
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
SLACK_SIGNING_SECRET = env("SLACK_SIGNING_SECRET")
STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET")
# Simulated checkout is available only for local development with an explicit opt-in.
ALLOW_MOCK_BILLING = env.bool("ALLOW_MOCK_BILLING", default=False)
MOCK_BILLING_ENABLED = (DEBUG or TESTING) and ALLOW_MOCK_BILLING
STRIPE_PRICES = {
    "growth": env("STRIPE_PRICE_GROWTH"),
    "enterprise": env("STRIPE_PRICE_ENTERPRISE"),
}
AGENT_EMAIL_DOMAIN = env("AGENT_EMAIL_DOMAIN").strip()
if TESTING and not AGENT_EMAIL_DOMAIN:
    AGENT_EMAIL_DOMAIN = "agents.invalid"

# Repositories agents must never pull, push, clone, or merge (comma-separated "owner/name").
AGENT_PROTECTED_REPOS = [
    repo.strip() for repo in env("AGENT_PROTECTED_REPOS", default="").split(",") if repo.strip()
]

# Deployment provider (see deployments/providers.py). Without a hook URL, deployments return 503.
DEPLOY_HOOK_URLS = {
    "dev": env("DEPLOY_HOOK_URL_DEV", default="").strip(),
    "staging": env("DEPLOY_HOOK_URL_STAGING", default="").strip(),
    "production": env("DEPLOY_HOOK_URL_PRODUCTION", default="").strip(),
}
DEPLOY_HOOK_SECRET = env("DEPLOY_HOOK_SECRET", default="").strip()
DEPLOY_CALLBACK_BASE_URL = env("DEPLOY_CALLBACK_BASE_URL", default="").strip()
DEPLOY_HOOK_TIMEOUT_SECONDS = env.int("DEPLOY_HOOK_TIMEOUT_SECONDS", default=15)
if any(DEPLOY_HOOK_URLS.values()) and not DEPLOY_HOOK_SECRET and not DEBUG and not TESTING:
    raise ImproperlyConfigured("DEPLOY_HOOK_SECRET is required when a deploy hook URL is configured.")

GIT_AUTHOR_NAME = env("GIT_AUTHOR_NAME", default="").strip()
GIT_AUTHOR_EMAIL = env("GIT_AUTHOR_EMAIL", default="").strip()
GITHUB_TOKEN = env("GITHUB_TOKEN", default="").strip()
# Whether workspaces without their own GitHub integration may use the operator's GITHUB_TOKEN.
# Keep this off for a multi-tenant deployment.
AGENT_ALLOW_PLATFORM_GITHUB_TOKEN = env.bool("AGENT_ALLOW_PLATFORM_GITHUB_TOKEN", default=DEBUG)
# External services used by agents. Defaults target the public GitHub API; set
# these for GitHub Enterprise or to point agents at other model providers.
GITHUB_API_URL = env("GITHUB_API_URL", default="https://api.github.com").rstrip("/")
GITHUB_WEB_URL = env("GITHUB_WEB_URL", default="https://github.com").rstrip("/")
GEMINI_API_KEY = env("GEMINI_API_KEY", default="").strip()
GEMINI_MODEL = env("GEMINI_MODEL", default="gemini-2.0-flash").strip()
OPENAI_API_KEY = env("OPENAI_API_KEY", default="").strip()
OPENAI_MODEL = env("OPENAI_MODEL", default="gpt-4o-mini").strip()
# Local Ollama is used only when OLLAMA_BASE_URL is set.
OLLAMA_BASE_URL = env("OLLAMA_BASE_URL", default="").strip().rstrip("/")
OLLAMA_MODEL = env("OLLAMA_MODEL", default="qwen2.5-coder:7b").strip()
GITHUB_ORG = env("GITHUB_ORG", default="").strip()
