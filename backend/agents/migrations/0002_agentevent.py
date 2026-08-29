import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_user_agent_key"),
        ("agents", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("session_id", models.CharField(db_index=True, max_length=128)),
                ("event_type", models.CharField(choices=[("queued", "Queued"), ("started", "Started"), ("progress", "Progress"), ("handoff", "Handoff"), ("blocked", "Blocked"), ("completed", "Completed"), ("failed", "Failed")], max_length=20)),
                ("sender_key", models.CharField(blank=True, max_length=64)),
                ("recipient_key", models.CharField(blank=True, max_length=64)),
                ("message", models.TextField()),
                ("current_work", models.TextField(blank=True)),
                ("remaining_work", models.JSONField(blank=True, default=list)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_events", to="organizations.organization")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_events", to="projects.project")),
                ("sender", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="agent_events", to="accounts.user")),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_events", to="tasks.task")),
                ("trace", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="events", to="agents.agentexecutiontrace")),
            ],
            options={
                "ordering": ["id"],
                "indexes": [
                    models.Index(fields=["organization", "project", "id"], name="agents_agen_organiz_0ca188_idx"),
                    models.Index(fields=["task", "session_id", "id"], name="agents_agen_task_id_f80b84_idx"),
                ],
            },
        ),
    ]
