from django.urls import path
from .views import (
    QueueMetricsView,
    DeadLetterListView,
    ReplayDeadLetterView,
    ReplayAllDeadLettersView,
    PurgeDeadLettersView,
    SimulateTaskFailureView,
)

urlpatterns = [
    path("metrics/", QueueMetricsView.as_view(), name="queue-metrics"),
    path("dlq/", DeadLetterListView.as_view(), name="dead-letter-list"),
    path("dlq/<int:pk>/replay/", ReplayDeadLetterView.as_view(), name="dead-letter-replay"),
    path("dlq/replay-all/", ReplayAllDeadLettersView.as_view(), name="dead-letter-replay-all"),
    path("dlq/purge-all/", PurgeDeadLettersView.as_view(), name="dead-letter-purge-all"),
    path("simulate-failure/", SimulateTaskFailureView.as_view(), name="simulate-failure"),
]
