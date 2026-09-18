from django.urls import path
from .views import (
    QueueMetricsView,
    DeadLetterListView,
    DeadLetterDetailView,
    ReplayDeadLetterView,
    ReplayAllDeadLettersView,
    PurgeDeadLettersView,
    SimulateTaskFailureView,
    OutboxListView,
    OutboxRelayView,
)

urlpatterns = [
    path("metrics/", QueueMetricsView.as_view(), name="queue-metrics"),
    path("dlq/", DeadLetterListView.as_view(), name="dead-letter-list"),
    path("dlq/<int:pk>/", DeadLetterDetailView.as_view(), name="dead-letter-detail"),
    path("dlq/<int:pk>/replay/", ReplayDeadLetterView.as_view(), name="dead-letter-replay"),
    path("dlq/replay-all/", ReplayAllDeadLettersView.as_view(), name="dead-letter-replay-all"),
    path("dlq/purge-all/", PurgeDeadLettersView.as_view(), name="dead-letter-purge-all"),
    path("outbox/", OutboxListView.as_view(), name="outbox-list"),
    path("outbox/relay/", OutboxRelayView.as_view(), name="outbox-relay"),
    path("simulate-failure/", SimulateTaskFailureView.as_view(), name="simulate-failure"),
]

