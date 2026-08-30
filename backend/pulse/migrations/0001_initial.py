# Generated manually to keep Pulse schema changes explicit and reviewable.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("organizations", "0001_initial"),
        ("tasks", "0003_task_contract_compliance_score_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="PulsePlanItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("time_block", models.CharField(choices=[("morning", "Morning"), ("afternoon", "Afternoon"), ("evening", "Evening")], default="morning", max_length=12)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_plan_items", to="organizations.organization")),
                ("task", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_plan_items", to="tasks.task")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_plan_items", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["date", "time_block", "position", "created_at"]},
        ),
        migrations.CreateModel(
            name="PulseNote",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("body", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_notes", to="organizations.organization")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_notes", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-date", "-updated_at"]},
        ),
        migrations.CreateModel(
            name="PulseFocusSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("active", "Active"), ("paused", "Paused"), ("completed", "Completed")], default="active", max_length=12)),
                ("started_at", models.DateTimeField()),
                ("last_resumed_at", models.DateTimeField(blank=True, null=True)),
                ("elapsed_seconds", models.PositiveIntegerField(default=0)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_focus_sessions", to="organizations.organization")),
                ("plan_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="focus_sessions", to="pulse.pulseplanitem")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pulse_focus_sessions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-started_at"]},
        ),
        migrations.AddConstraint(
            model_name="pulseplanitem",
            constraint=models.UniqueConstraint(fields=("user", "date", "task"), name="pulse_unique_daily_task_per_user"),
        ),
        migrations.AddIndex(
            model_name="pulseplanitem",
            index=models.Index(fields=["organization", "user", "date"], name="pulse_pulse_organiz_957b7b_idx"),
        ),
        migrations.AddConstraint(
            model_name="pulsenote",
            constraint=models.UniqueConstraint(fields=("user", "date"), name="pulse_unique_daily_note_per_user"),
        ),
        migrations.AddIndex(
            model_name="pulsenote",
            index=models.Index(fields=["organization", "user", "date"], name="pulse_pulse_organiz_0d621f_idx"),
        ),
        migrations.AddIndex(
            model_name="pulsefocussession",
            index=models.Index(fields=["organization", "user", "status"], name="pulse_pulse_organiz_803300_idx"),
        ),
        migrations.AddIndex(
            model_name="pulsefocussession",
            index=models.Index(fields=["organization", "user", "started_at"], name="pulse_pulse_organiz_b800b4_idx"),
        ),
    ]
