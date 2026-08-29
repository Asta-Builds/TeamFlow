from django.db import migrations, models


AGENT_KEYS_BY_EMAIL = {
    "pm@teamflow.dev": "pm",
    "lead@teamflow.dev": "tech_lead",
    "backend1@teamflow.dev": "backend_core",
    "backend2@teamflow.dev": "backend_integrations",
    "frontend1@teamflow.dev": "frontend_app",
    "frontend2@teamflow.dev": "frontend_design_system",
    "devops@teamflow.dev": "devops",
    "qa@teamflow.dev": "qa",
    "design@teamflow.dev": "designer",
    "seo@teamflow.dev": "seo",
}


def populate_agent_keys(apps, _schema_editor):
    User = apps.get_model("accounts", "User")
    for email, agent_key in AGENT_KEYS_BY_EMAIL.items():
        User.objects.filter(email=email).update(agent_key=agent_key)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_alter_user_role")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="agent_key",
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
        migrations.RunPython(populate_agent_keys, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                condition=~models.Q(agent_key=""),
                fields=("organization", "agent_key"),
                name="unique_agent_seat_per_organization",
            ),
        ),
    ]
