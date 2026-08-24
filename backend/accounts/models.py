from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Manager for the email-as-username custom user model."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """TeamFlow user. Email is the login identifier; role scopes permissions."""

    class Role(models.TextChoices):
        CEO = "ceo", "CEO"
        PM = "pm", "Product Manager"
        TECH_LEAD = "tech_lead", "Tech Lead"
        BACKEND = "backend", "Backend Developer"
        FRONTEND = "frontend", "Frontend Developer"
        DEVOPS = "devops", "DevOps Engineer"
        QA = "qa", "QA Engineer"
        DESIGNER = "designer", "UI/UX Designer"
        SEO = "seo", "SEO Specialist"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        OFFLINE = "offline", "Offline"
        PENDING = "pending", "Pending Approval"
        DISABLED = "disabled", "Disabled"

    username = None
    email = models.EmailField("email address", unique=True)
    name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    user_status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    avatar_url = models.URLField(blank=True)
    bio = models.TextField(blank=True)
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="users"
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        ordering = ["name", "email"]

    def __str__(self):
        return self.name or self.email

    @property
    def is_ai_agent(self):
        """All profiles in the virtual tech company are autonomous AI agents except the human CEO/Founder."""
        return self.role != self.Role.CEO

    @property
    def is_privileged(self):
        """CEO / Tech Lead / Admin / staff can manage projects, team members, and the workspace."""
        return (
            self.is_staff
            or self.is_superuser
            or self.role in {self.Role.ADMIN, self.Role.CEO, self.Role.TECH_LEAD}
        )

    @property
    def can_create_project(self):
        return self.is_privileged

    @property
    def can_deploy(self):
        return self.is_privileged or self.role == self.Role.DEVOPS

    @property
    def can_audit_seo(self):
        return self.is_privileged or self.role == self.Role.SEO

    @property
    def can_validate_qa(self):
        return self.is_privileged or self.role == self.Role.QA
