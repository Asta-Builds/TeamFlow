from django.db import migrations

HUMAN_ROLES = {"ceo", "admin", "member"}


def human_role_for(role):
    if role in HUMAN_ROLES:
        return role
    if role == "tech_lead":
        return "admin"
    return "member"


def backfill(apps, schema_editor):
    """
    Give every person a seat in the workspace they belong to.

    Specialist roles are reserved for AI agent seats, so people who held one are
    moved to the closest workspace role (Tech Lead -> Admin, others -> Member).
    """
    User = apps.get_model("accounts", "User")
    Membership = apps.get_model("organizations", "Membership")

    for user in User.objects.filter(agent_key="").only("id", "role", "organization_id").iterator():
        role = human_role_for(user.role)
        if role != user.role:
            User.objects.filter(pk=user.pk).update(role=role)
        if user.organization_id is not None:
            Membership.objects.get_or_create(
                user_id=user.pk,
                organization_id=user.organization_id,
                defaults={"role": role, "status": "active"},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0002_membership"),
        ("accounts", "0005_user_clerk_id"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
