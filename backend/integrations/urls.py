from django.urls import path
from .views import SlackIntegrationView, SlackTestView, SlackEventsWebhookView

urlpatterns = [
    path("slack/", SlackIntegrationView.as_view(), name="slack-integration-detail"),
    path("slack/connect/", SlackIntegrationView.as_view(), name="slack-integration-connect"),
    path("slack/test/", SlackTestView.as_view(), name="slack-integration-test"),
    path("slack/events/", SlackEventsWebhookView.as_view(), name="slack-events-webhook"),
]
