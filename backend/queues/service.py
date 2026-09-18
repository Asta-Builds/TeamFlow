import json
import logging
import urllib.request
import urllib.error
import base64
from typing import Dict, Any, List, Optional
from django.conf import settings
from django.utils import timezone
from celery import current_app
from kombu import Connection, Exchange, Queue, Producer

logger = logging.getLogger(__name__)


class RabbitMQService:
    """
    Unified manager for RabbitMQ asynchronous communication and Dead Letter Queue (DLQ).
    Provides queue declarations, message publishing, queue inspection, and replay mechanisms.
    """

    @classmethod
    def get_broker_url(cls) -> str:
        """Returns the configured broker URL (RabbitMQ or Celery fallback)."""
        return getattr(settings, "RABBITMQ_URL", "") or getattr(settings, "CELERY_BROKER_URL", "")

    @classmethod
    def is_rabbitmq_broker(cls) -> bool:
        """Checks if the active broker is an AMQP / RabbitMQ broker."""
        url = cls.get_broker_url()
        return url.startswith("amqp://") or url.startswith("pyamqp://")

    @classmethod
    def get_broker_status(cls) -> Dict[str, Any]:
        """
        Tests connectivity to the messaging broker.
        Returns status dictionary with connection health, broker type, and details.
        """
        broker_url = cls.get_broker_url()
        if not broker_url:
            return {
                "connected": False,
                "broker_type": "none",
                "message": "No broker URL configured (RABBITMQ_URL / CELERY_BROKER_URL empty)",
            }

        broker_type = "rabbitmq" if cls.is_rabbitmq_broker() else "redis"
        try:
            with Connection(broker_url, timeout=3.0) as conn:
                conn.connect()
                return {
                    "connected": True,
                    "broker_type": broker_type,
                    "transport": conn.transport.driver_type if hasattr(conn.transport, "driver_type") else broker_type,
                    "message": "Broker online and operational",
                }
        except Exception as exc:
            logger.warning("Broker connectivity check failed: %s", exc)
            return {
                "connected": False,
                "broker_type": broker_type,
                "message": str(exc),
            }

    @classmethod
    def publish_async_message(
        cls,
        queue_name: str = "teamflow.tasks",
        payload: Optional[Dict[str, Any]] = None,
        routing_key: str = "tasks",
        exchange_name: str = "teamflow",
        headers: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Publishes a message directly into a RabbitMQ / Kombu queue with DLQ routing.
        """
        broker_url = cls.get_broker_url()
        if not broker_url:
            logger.error("Cannot publish message: broker URL is not configured.")
            return False

        payload = payload or {}
        headers = headers or {}

        try:
            with Connection(broker_url, timeout=5.0) as conn:
                exchange = Exchange(exchange_name, type="direct", durable=True)
                dlx = Exchange("teamflow.dlx", type="direct", durable=True)

                queue = Queue(
                    queue_name,
                    exchange=exchange,
                    routing_key=routing_key,
                    durable=True,
                    queue_arguments={
                        "x-dead-letter-exchange": "teamflow.dlx",
                        "x-dead-letter-routing-key": "dlq",
                    },
                )
                queue(conn.default_channel).declare()

                # Also ensure DLQ exists
                dlq = Queue("teamflow.dlq", exchange=dlx, routing_key="dlq", durable=True)
                dlq(conn.default_channel).declare()

                producer = Producer(conn.default_channel, exchange=exchange, routing_key=routing_key)
                producer.publish(
                    payload,
                    serializer="json",
                    content_type="application/json",
                    headers=headers,
                    delivery_mode=2,  # Persistent message
                )
                logger.info("Published message to queue '%s' with routing key '%s'", queue_name, routing_key)
                return True
        except Exception as exc:
            logger.exception("Failed to publish message to queue '%s': %s", queue_name, exc)
            return False

    @classmethod
    def replay_message(cls, dead_letter_id: int) -> Dict[str, Any]:
        """
        Replays a dead letter message back into its destination queue.
        Dispatches via Celery task if recognized, or publishes via Kombu AMQP.
        """
        from .models import DeadLetterMessage

        try:
            dl_msg = DeadLetterMessage.objects.get(id=dead_letter_id)
        except DeadLetterMessage.DoesNotExist:
            return {"success": False, "error": f"DeadLetterMessage {dead_letter_id} does not exist"}

        try:
            target_queue = dl_msg.queue_name or "teamflow.tasks"
            replayed_task_id = None

            # 1. If it's a known Celery task, re-send using Celery current_app
            if dl_msg.task_name:
                async_res = current_app.send_task(
                    dl_msg.task_name,
                    args=dl_msg.args or [],
                    kwargs=dl_msg.kwargs or {},
                    queue=target_queue,
                )
                replayed_task_id = async_res.id

            # 2. If it's a standalone payload, re-publish via Kombu
            elif dl_msg.payload:
                cls.publish_async_message(
                    queue_name=target_queue,
                    payload=dl_msg.payload,
                    routing_key=dl_msg.routing_key or "tasks",
                    exchange_name=dl_msg.exchange or "teamflow",
                )

            # Update DLQ state in DB
            dl_msg.status = DeadLetterMessage.Status.REPLAYED
            dl_msg.retry_count += 1
            dl_msg.last_replayed_at = timezone.now()
            dl_msg.save(update_fields=["status", "retry_count", "last_replayed_at", "updated_at"])

            logger.info("Successfully replayed dead letter %s (New Task ID: %s)", dead_letter_id, replayed_task_id)
            return {
                "success": True,
                "message_id": dead_letter_id,
                "replayed_task_id": replayed_task_id,
                "queue": target_queue,
            }
        except Exception as exc:
            logger.exception("Failed to replay dead letter %s: %s", dead_letter_id, exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def replay_all_pending(cls) -> Dict[str, Any]:
        """Replays all dead letter messages with status=PENDING."""
        from .models import DeadLetterMessage

        pending_ids = list(
            DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PENDING).values_list("id", flat=True)
        )
        replayed_count = 0
        errors = []

        for dl_id in pending_ids:
            res = cls.replay_message(dl_id)
            if res.get("success"):
                replayed_count += 1
            else:
                errors.append(f"ID {dl_id}: {res.get('error')}")

        return {
            "total_pending": len(pending_ids),
            "replayed_count": replayed_count,
            "errors": errors,
        }

    @classmethod
    def purge_dlq(cls) -> Dict[str, Any]:
        """
        Purges messages in the RabbitMQ teamflow.dlq queue and updates DB records to PURGED.
        """
        from .models import DeadLetterMessage

        # 1. Update database records
        updated_rows = DeadLetterMessage.objects.filter(
            status=DeadLetterMessage.Status.PENDING
        ).update(status=DeadLetterMessage.Status.PURGED, updated_at=timezone.now())

        # 2. Attempt to purge the AMQP queue directly
        amqp_purged = 0
        broker_url = cls.get_broker_url()
        if broker_url:
            try:
                with Connection(broker_url, timeout=4.0) as conn:
                    dlx = Exchange("teamflow.dlx", type="direct", durable=True)
                    dlq = Queue("teamflow.dlq", exchange=dlx, routing_key="dlq", durable=True)
                    amqp_purged = dlq(conn.default_channel).purge()
            except Exception as exc:
                logger.warning("AMQP DLQ purge notice: %s", exc)

        return {
            "db_records_purged": updated_rows,
            "amqp_messages_purged": amqp_purged,
        }

    @classmethod
    def get_management_queue_stats(cls) -> List[Dict[str, Any]]:
        """
        Fetches queue statistics from the RabbitMQ Management HTTP API if reachable.
        Falls back to local / Kombu estimations.
        """
        mgmt_url = getattr(settings, "RABBITMQ_MANAGEMENT_URL", "http://localhost:15672").rstrip("/")
        user = getattr(settings, "RABBITMQ_MANAGEMENT_USER", "teamflow")
        password = getattr(settings, "RABBITMQ_MANAGEMENT_PASS", "teamflow_password")

        api_endpoint = f"{mgmt_url}/api/queues"
        req = urllib.request.Request(api_endpoint)
        auth_header = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {auth_header}")

        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    stats = []
                    for q in data:
                        stats.append({
                            "name": q.get("name"),
                            "messages": q.get("messages", 0),
                            "messages_ready": q.get("messages_ready", 0),
                            "messages_unacknowledged": q.get("messages_unacknowledged", 0),
                            "consumers": q.get("consumers", 0),
                            "state": q.get("state", "running"),
                        })
                    return stats
        except Exception as exc:
            logger.debug("RabbitMQ management HTTP API not reachable: %s", exc)

        # Fallback default statistics
        from .models import DeadLetterMessage
        pending_dlq_count = DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PENDING).count()
        return [
            {
                "name": "teamflow.tasks",
                "messages": "N/A",
                "messages_ready": "N/A",
                "messages_unacknowledged": 0,
                "consumers": 1,
                "state": "active",
            },
            {
                "name": "teamflow.dlq",
                "messages": pending_dlq_count,
                "messages_ready": pending_dlq_count,
                "messages_unacknowledged": 0,
                "consumers": 0,
                "state": "active" if pending_dlq_count == 0 else "requires_attention",
            },
        ]

    @classmethod
    def record_outbox_message(
        cls,
        event_type: str,
        payload: Dict[str, Any],
        routing_key: str = "events",
        exchange: str = "teamflow.events",
        headers: Optional[Dict[str, Any]] = None,
    ):
        """
        Records a domain event in the Transactional Outbox.
        Executed within the caller's active database transaction to guarantee atomicity.
        """
        from .models import OutboxMessage

        return OutboxMessage.objects.create(
            event_type=event_type,
            exchange=exchange,
            routing_key=routing_key,
            payload=payload,
            headers=headers or {},
            status=OutboxMessage.Status.PENDING,
        )

    @classmethod
    def relay_pending_outbox(cls, batch_size: int = 50) -> Dict[str, Any]:
        """
        Drains pending Transactional Outbox messages and publishes them
        to the RabbitMQ / AMQP topic exchange.
        """
        from .models import OutboxMessage, DeadLetterMessage

        pending_messages = list(
            OutboxMessage.objects.filter(status=OutboxMessage.Status.PENDING).order_by("created_at")[:batch_size]
        )
        published_count = 0
        failed_count = 0
        errors = []

        for msg in pending_messages:
            success = cls.publish_async_message(
                queue_name=msg.routing_key,
                payload=msg.payload,
                routing_key=msg.routing_key,
                exchange_name=msg.exchange,
                headers=msg.headers,
            )
            if success:
                msg.status = OutboxMessage.Status.PUBLISHED
                msg.published_at = timezone.now()
                msg.save(update_fields=["status", "published_at"])
                published_count += 1
            else:
                msg.retry_count += 1
                msg.last_error = "Failed to deliver message to broker."
                if msg.retry_count >= 5:
                    msg.status = OutboxMessage.Status.FAILED
                    # Log into DeadLetterMessage for visibility
                    DeadLetterMessage.objects.create(
                        task_id=str(msg.event_id),
                        task_name=f"outbox.{msg.event_type}",
                        queue_name=msg.routing_key,
                        routing_key=msg.routing_key,
                        exchange=msg.exchange,
                        payload=msg.payload,
                        exception_class="OutboxDeliveryError",
                        exception_message="Failed to deliver outbox event to AMQP broker after 5 attempts.",
                        status=DeadLetterMessage.Status.PENDING,
                    )
                msg.save(update_fields=["status", "retry_count", "last_error"])
                failed_count += 1
                errors.append(f"Event {msg.event_id} ({msg.event_type}) failed delivery.")

        return {
            "total_processed": len(pending_messages),
            "published_count": published_count,
            "failed_count": failed_count,
            "errors": errors,
        }

