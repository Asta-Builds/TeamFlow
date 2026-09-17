from django.db import models

class Organization(models.Model):
    class Tier(models.TextChoices):
        STARTER = "starter", "Starter"
        GROWTH = "growth", "Growth"
        ENTERPRISE = "enterprise", "Enterprise"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Past Due"
        CANCELED = "canceled", "Canceled"
        INCOMPLETE = "incomplete", "Incomplete"

    name = models.CharField(max_length=255)
    stripe_customer_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True)
    subscription_tier = models.CharField(
        max_length=20,
        choices=Tier.choices,
        default=Tier.STARTER,
    )
    subscription_status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE, # Default active for dev ease/Starter tier
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class Membership(models.Model):
    """
    A human's seat in a workspace.

    People can belong to several workspaces, each with its own role. The user's
    ``organization`` and ``role`` fields hold the active workspace and the role in
    it; they are kept in sync when the user switches workspaces. AI agent accounts
    never have memberships: they belong to exactly one workspace through
    ``User.organization`` and are identified by ``User.agent_key``.
    """

    class Role(models.TextChoices):
        OWNER = "ceo", "Owner (CEO)"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INVITED = "invited", "Invited"

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    invited_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["organization_id", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "organization"],
                name="unique_membership_per_workspace",
            )
        ]
        indexes = [models.Index(fields=["organization", "status"], name="membership_org_status_idx")]

    def __str__(self):
        return f"{self.user} @ {self.organization} ({self.role}, {self.status})"
