from django.urls import path
from . import views
from .integrations import stripe_webhook

urlpatterns = [
    path('api/v1/stripe-webhook/', stripe_webhook.stripe_webhook, name='stripe-webhook'),
    # Other URL patterns
]