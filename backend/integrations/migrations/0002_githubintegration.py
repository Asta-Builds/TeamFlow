# Generated for TeamFlow GitHub Integration and DevOps Agent

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0001_initial'),
        ('integrations', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='GitHubIntegration',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('github_token', models.CharField(blank=True, help_text='GitHub Personal Access Token (ghp_... or gho_...) with repo/workflow scopes', max_length=255)),
                ('github_org', models.CharField(blank=True, default='', help_text='Default GitHub Organization or User login (e.g. Asta-Builds)', max_length=100)),
                ('default_visibility', models.CharField(choices=[('public', 'Public'), ('private', 'Private')], default='public', max_length=20)),
                ('auto_init', models.BooleanField(default=True, help_text='Automatically initialize README.md on creation')),
                ('include_ci_workflow', models.BooleanField(default=True, help_text='Automatically inject DevOps GitHub Actions CI workflow')),
                ('is_enabled', models.BooleanField(default=True)),
                ('account_login', models.CharField(blank=True, default='', max_length=100)),
                ('account_name', models.CharField(blank=True, default='', max_length=150)),
                ('account_avatar_url', models.URLField(blank=True, default='', max_length=500)),
                ('account_type', models.CharField(blank=True, default='User', max_length=50)),
                ('public_repos_count', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('organization', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='github_integration', to='organizations.organization')),
            ],
        ),
    ]
