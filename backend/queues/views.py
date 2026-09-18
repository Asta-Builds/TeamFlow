from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.utils import timezone

from .models import DeadLetterMessage
from .service import RabbitMQService
from .tasks import simulate_failing_task


class QueueMetricsView(APIView):
    """Returns real-time RabbitMQ and DLQ metrics."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        broker_status = RabbitMQService.get_broker_status()
        queue_stats = RabbitMQService.get_management_queue_stats()

        total_dlq = DeadLetterMessage.objects.count()
        pending_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PENDING).count()
        replayed_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.REPLAYED).count()
        purged_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PURGED).count()

        return Response({
            "broker": broker_status,
            "queues": queue_stats,
            "dlq_summary": {
                "total": total_dlq,
                "pending": pending_dlq,
                "replayed": replayed_dlq,
                "purged": purged_dlq,
            },
            "timestamp": timezone.now().isoformat(),
        })


class DeadLetterListView(APIView):
    """Lists dead-lettered messages."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        status_filter = request.query_params.get("status")
        queryset = DeadLetterMessage.objects.all()
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        limit = min(int(request.query_params.get("limit", 50)), 100)
        messages = queryset[:limit]

        data = [
            {
                "id": msg.id,
                "task_id": msg.task_id,
                "task_name": msg.task_name,
                "queue_name": msg.queue_name,
                "status": msg.status,
                "exception_class": msg.exception_class,
                "exception_message": msg.exception_message,
                "retry_count": msg.retry_count,
                "created_at": msg.created_at.isoformat(),
                "last_replayed_at": msg.last_replayed_at.isoformat() if msg.last_replayed_at else None,
            }
            for msg in messages
        ]
        return Response({"results": data, "count": queryset.count()})


class ReplayDeadLetterView(APIView):
    """Replays a single dead-lettered message back into RabbitMQ/Celery."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        result = RabbitMQService.replay_message(pk)
        status_code = status.HTTP_200_OK if result.get("success") else status.HTTP_400_BAD_REQUEST
        return Response(result, status=status_code)


class ReplayAllDeadLettersView(APIView):
    """Replays all pending dead-lettered messages."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        result = RabbitMQService.replay_all_pending()
        return Response(result, status=status.HTTP_200_OK)


class PurgeDeadLettersView(APIView):
    """Purges pending dead-lettered messages in DB and broker."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        result = RabbitMQService.purge_dlq()
        return Response(result, status=status.HTTP_200_OK)


class SimulateTaskFailureView(APIView):
    """Test endpoint to trigger a simulated failure that routes into DLQ."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        error_msg = request.data.get("message", "Triggered test dead letter")
        task = simulate_failing_task.delay(error_message=error_msg, should_fail=True)
        return Response(
            {"message": "Simulated task queued for execution", "task_id": task.id},
            status=status.HTTP_202_ACCEPTED,
        )
