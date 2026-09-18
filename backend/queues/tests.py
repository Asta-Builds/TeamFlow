from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status

from .models import DeadLetterMessage
from .service import RabbitMQService
from .signals import handle_celery_task_failure

User = get_user_model()


class DeadLetterMessageModelTests(TestCase):
    def test_create_dead_letter_message(self):
        msg = DeadLetterMessage.objects.create(
            task_id="task-uuid-1234",
            task_name="agents.tasks.execute_graph_run",
            queue_name="teamflow.tasks",
            routing_key="tasks",
            payload={"test": "data"},
            args=[123, "arg"],
            kwargs={"key": "value"},
            exception_class="ValueError",
            exception_message="Invalid token count",
            traceback="Traceback (most recent call last): ...",
        )
        self.assertEqual(msg.status, DeadLetterMessage.Status.PENDING)
        self.assertEqual(msg.retry_count, 0)
        self.assertIn("DLQ [pending] agents.tasks.execute_graph_run", str(msg))


class RabbitMQServiceTests(TestCase):
    def setUp(self):
        self.msg = DeadLetterMessage.objects.create(
            task_id="task-uuid-5678",
            task_name="agents.tasks.execute_prompt_run",
            queue_name="teamflow.tasks",
            args=[42],
            kwargs={"prompt": "build feature"},
            exception_class="RuntimeError",
            exception_message="Provider timeout",
        )

    @patch("queues.service.current_app.send_task")
    def test_replay_message_success(self, mock_send_task):
        mock_task_res = MagicMock()
        mock_task_res.id = "new-task-uuid-999"
        mock_send_task.return_value = mock_task_res

        result = RabbitMQService.replay_message(self.msg.id)
        self.assertTrue(result["success"])
        self.assertEqual(result["replayed_task_id"], "new-task-uuid-999")

        self.msg.refresh_from_db()
        self.assertEqual(self.msg.status, DeadLetterMessage.Status.REPLAYED)
        self.assertEqual(self.msg.retry_count, 1)
        self.assertIsNotNone(self.msg.last_replayed_at)
        mock_send_task.assert_called_once_with(
            "agents.tasks.execute_prompt_run",
            args=[42],
            kwargs={"prompt": "build feature"},
            queue="teamflow.tasks",
        )

    def test_replay_nonexistent_message(self):
        result = RabbitMQService.replay_message(99999)
        self.assertFalse(result["success"])

    @patch("queues.service.current_app.send_task")
    def test_replay_all_pending(self, mock_send_task):
        mock_task_res = MagicMock()
        mock_task_res.id = "replayed-task-uuid"
        mock_send_task.return_value = mock_task_res

        DeadLetterMessage.objects.create(
            task_id="task-uuid-2",
            task_name="tasks.debug_task",
            status=DeadLetterMessage.Status.PENDING,
        )

        result = RabbitMQService.replay_all_pending()
        self.assertEqual(result["total_pending"], 2)
        self.assertEqual(result["replayed_count"], 2)
        self.assertEqual(DeadLetterMessage.objects.filter(status=DeadLetterMessage.Status.PENDING).count(), 0)

    @patch("queues.service.Connection")
    def test_purge_dlq(self, mock_conn):
        result = RabbitMQService.purge_dlq()
        self.assertEqual(result["db_records_purged"], 1)
        self.msg.refresh_from_db()
        self.assertEqual(self.msg.status, DeadLetterMessage.Status.PURGED)

    @patch("queues.service.Connection")
    def test_get_broker_status(self, mock_conn):
        mock_instance = MagicMock()
        mock_conn.return_value.__enter__.return_value = mock_instance
        status_info = RabbitMQService.get_broker_status()
        self.assertIn("connected", status_info)
        self.assertIn("broker_type", status_info)


class CelerySignalTests(TestCase):
    def test_handle_celery_task_failure_creates_dlq_message(self):
        sender_mock = MagicMock()
        sender_mock.name = "pulse.tasks.calculate_velocity"

        handle_celery_task_failure(
            sender=sender_mock,
            task_id="celery-fail-uuid-1",
            exception=KeyError("Missing metric key"),
            args=["org-123"],
            kwargs={"days": 7},
            einfo="Traceback: KeyError: Missing metric key",
        )

        dlq_entry = DeadLetterMessage.objects.filter(task_id="celery-fail-uuid-1").first()
        self.assertIsNotNone(dlq_entry)
        self.assertEqual(dlq_entry.task_name, "pulse.tasks.calculate_velocity")
        self.assertEqual(dlq_entry.exception_class, "KeyError")
        self.assertEqual(dlq_entry.status, DeadLetterMessage.Status.PENDING)
        self.assertEqual(dlq_entry.args, ["org-123"])
        self.assertEqual(dlq_entry.kwargs, {"days": 7})


class QueueAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="developer@teamflow.dev",
            password="securepassword123",
        )
        self.client.force_authenticate(user=self.user)
        self.dlq_msg = DeadLetterMessage.objects.create(
            task_id="api-task-uuid",
            task_name="agents.tasks.execute_graph_run",
            exception_class="TimeoutError",
            exception_message="RAG database unreachable",
            status=DeadLetterMessage.Status.PENDING,
        )

    def test_get_queue_metrics(self):
        response = self.client.get(reverse("queue-metrics"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("broker", data)
        self.assertIn("queues", data)
        self.assertIn("dlq_summary", data)
        self.assertEqual(data["dlq_summary"]["total"], 1)
        self.assertEqual(data["dlq_summary"]["pending"], 1)

    def test_get_dead_letter_list(self):
        response = self.client.get(reverse("dead-letter-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["task_id"], "api-task-uuid")

    @patch("queues.service.current_app.send_task")
    def test_replay_dead_letter_api(self, mock_send_task):
        mock_task_res = MagicMock()
        mock_task_res.id = "replayed-task-id"
        mock_send_task.return_value = mock_task_res

        url = reverse("dead-letter-replay", kwargs={"pk": self.dlq_msg.id})
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.json()["success"])

        self.dlq_msg.refresh_from_db()
        self.assertEqual(self.dlq_msg.status, DeadLetterMessage.Status.REPLAYED)

    @patch("queues.service.current_app.send_task")
    def test_replay_all_dead_letters_api(self, mock_send_task):
        mock_task_res = MagicMock()
        mock_task_res.id = "batch-replay-id"
        mock_send_task.return_value = mock_task_res

        url = reverse("dead-letter-replay-all")
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["replayed_count"], 1)

    def test_purge_dead_letters_api(self):
        url = reverse("dead-letter-purge-all")
        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.dlq_msg.refresh_from_db()
        self.assertEqual(self.dlq_msg.status, DeadLetterMessage.Status.PURGED)
