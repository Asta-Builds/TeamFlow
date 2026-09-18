from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.utils import timezone

from .models import DeadLetterMessage, OutboxMessage
from .service import RabbitMQService
from .tasks import simulate_failing_task


class QueueMetricsView(APIView):
    """Returns real-time RabbitMQ, DLQ, and Transactional Outbox metrics."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        broker_status = RabbitMQService.get_broker_status()
        queue_stats = RabbitMQService.get_management_queue_stats()

        total_dlq = DeadLetterMessage.objects.count()
        pending_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PENDING).count()
        replayed_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.REPLAYED).count()
        purged_dlq = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PURGED).count()

        total_outbox = OutboxMessage.objects.count()
        pending_outbox = OutboxMessage.objects.filter(status=OutboxMessage.Status.PENDING).count()
        published_outbox = OutboxMessage.objects.filter(status=OutboxMessage.Status.PUBLISHED).count()
        failed_outbox = OutboxMessage.objects.filter(status=OutboxMessage.Status.FAILED).count()

        return Response({
            "broker": broker_status,
            "queues": queue_stats,
            "dlq_summary": {
                "total": total_dlq,
                "pending": pending_dlq,
                "replayed": replayed_dlq,
                "purged": purged_dlq,
            },
            "outbox_summary": {
                "total": total_outbox,
                "pending": pending_outbox,
                "published": published_outbox,
                "failed": failed_outbox,
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
                "routing_key": msg.routing_key,
                "exchange": msg.exchange,
                "payload": msg.payload,
                "args": msg.args,
                "kwargs": msg.kwargs,
                "status": msg.status,
                "exception_class": msg.exception_class,
                "exception_message": msg.exception_message,
                "traceback": msg.traceback,
                "retry_count": msg.retry_count,
                "created_at": msg.created_at.isoformat(),
                "last_replayed_at": msg.last_replayed_at.isoformat() if msg.last_replayed_at else None,
            }
            for msg in messages
        ]
        return Response({"results": data, "count": queryset.count()})


class DeadLetterDetailView(APIView):
    """Retrieves full detail of a single dead-letter message."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            msg = DeadLetterMessage.objects.get(pk=pk)
        except DeadLetterMessage.DoesNotExist:
            return Response({"detail": "Dead letter message not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "id": msg.id,
            "task_id": msg.task_id,
            "task_name": msg.task_name,
            "queue_name": msg.queue_name,
            "routing_key": msg.routing_key,
            "exchange": msg.exchange,
            "payload": msg.payload,
            "args": msg.args,
            "kwargs": msg.kwargs,
            "status": msg.status,
            "exception_class": msg.exception_class,
            "exception_message": msg.exception_message,
            "traceback": msg.traceback,
            "retry_count": msg.retry_count,
            "created_at": msg.created_at.isoformat(),
            "last_replayed_at": msg.last_replayed_at.isoformat() if msg.last_replayed_at else None,
        })


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


class OutboxListView(APIView):
    """Lists Transactional Outbox messages."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        status_filter = request.query_params.get("status")
        queryset = OutboxMessage.objects.all()
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        limit = min(int(request.query_params.get("limit", 50)), 100)
        messages = queryset[:limit]

        data = [
            {
                "id": msg.id,
                "event_id": str(msg.event_id),
                "event_type": msg.event_type,
                "exchange": msg.exchange,
                "routing_key": msg.routing_key,
                "payload": msg.payload,
                "headers": msg.headers,
                "status": msg.status,
                "retry_count": msg.retry_count,
                "last_error": msg.last_error,
                "created_at": msg.created_at.isoformat(),
                "published_at": msg.published_at.isoformat() if msg.published_at else None,
            }
            for msg in messages
        ]
        return Response({"results": data, "count": queryset.count()})


class OutboxRelayView(APIView):
    """Triggers an outbox relay execution to drain pending messages to RabbitMQ."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        batch_size = min(int(request.data.get("batch_size", 50)), 200)
        result = RabbitMQService.relay_pending_outbox(batch_size=batch_size)
        return Response(result, status=status.HTTP_200_OK)

