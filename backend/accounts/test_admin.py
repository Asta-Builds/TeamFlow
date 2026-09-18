from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.urls import reverse

User = get_user_model()


class AdminFrontendTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin_user = User.objects.create_superuser(
            email="admin@teamflow.dev",
            password="AdminPassword123!",
            name="Super Admin",
        )

    def test_admin_login_page_renders(self):
        response = self.client.get(reverse("admin:login"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "TeamFlow Console")
        self.assertContains(response, "tf-auth-card")
        self.assertContains(response, "Back to Web App")
        self.assertContains(response, "teamflow_admin.css")

    def test_admin_index_page_renders_with_deck(self):
        self.client.force_login(self.admin_user)
        response = self.client.get(reverse("admin:index"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "RabbitMQ & DLQ")
        self.assertContains(response, "LangGraph AI Swarm")
        self.assertContains(response, "tf-dashboard-deck")
        self.assertContains(response, "tf-dashboard-grid")
        self.assertContains(response, "Manage DLQ")

    def test_admin_dlq_changelist_renders(self):
        self.client.force_login(self.admin_user)
        response = self.client.get(reverse("admin:queues_deadlettermessage_changelist"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Dead Letter Queue")
        self.assertContains(response, "Replay All Pending")
