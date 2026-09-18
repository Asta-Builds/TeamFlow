import logging
from celery import shared_task
from .service import RabbitMQService

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=1)
def simulate_failing_task(self, error_message: str = "Simulated DLQ pipeline failure", should_fail: bool = True):
    """
    Test task used to verify Celery task execution and automated DLQ capture.
    When should_fail is True, intentionally raises an exception to route to DLQ.
    """
    logger.info("Executing simulate_failing_task (Task ID: %s, should_fail: %s)", self.request.id, should_fail)
    if should_fail:
        raise ValueError(error_message)
    return {"status": "success", "task_id": self.request.id, "message": "Processed without error"}


@shared_task(bind=True)
def dispatch_rabbitmq_event(self, event_type: str, payload: dict, routing_key: str = "tasks"):
    """
    Asynchronous task that publishes events via RabbitMQ AMQP queue with DLQ routing.
    """
    logger.info("Dispatching async RabbitMQ event: %s", event_type)
    return RabbitMQService.publish_async_message(
        queue_name="teamflow.tasks",
        payload={"event_type": event_type, "data": payload},
        routing_key=routing_key,
    )


@shared_task(bind=True)
def relay_outbox_messages_task(self, batch_size: int = 50):
    """
    Background Celery worker task that drains pending Transactional Outbox messages
    and publishes them to RabbitMQ topic exchange.
    """
    logger.debug("Executing relay_outbox_messages_task with batch_size=%d", batch_size)
    return RabbitMQService.relay_pending_outbox(batch_size=batch_size)

