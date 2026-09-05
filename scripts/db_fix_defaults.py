import subprocess

sql = """
ALTER TABLE accounts_user ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE accounts_user ALTER COLUMN last_name SET DEFAULT '';
ALTER TABLE accounts_user ALTER COLUMN name SET DEFAULT '';
ALTER TABLE accounts_user ALTER COLUMN is_superuser SET DEFAULT false;
ALTER TABLE accounts_user ALTER COLUMN is_staff SET DEFAULT false;
ALTER TABLE accounts_user ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE accounts_user ALTER COLUMN date_joined SET DEFAULT now();
ALTER TABLE accounts_user ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE accounts_user ALTER COLUMN avatar_url SET DEFAULT '';
ALTER TABLE accounts_user ALTER COLUMN bio SET DEFAULT '';
ALTER TABLE accounts_user ALTER COLUMN user_status SET DEFAULT 'active';
ALTER TABLE accounts_user ALTER COLUMN agent_key SET DEFAULT '';

ALTER TABLE organizations_organization ALTER COLUMN subscription_tier SET DEFAULT 'starter';
ALTER TABLE organizations_organization ALTER COLUMN subscription_status SET DEFAULT 'active';
ALTER TABLE organizations_organization ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE projects_project ALTER COLUMN description SET DEFAULT '';
ALTER TABLE projects_project ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE projects_project ALTER COLUMN github_repo SET DEFAULT '';
ALTER TABLE projects_project ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE projects_project ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE tasks_task ALTER COLUMN description SET DEFAULT '';
ALTER TABLE tasks_task ALTER COLUMN status SET DEFAULT 'todo';
ALTER TABLE tasks_task ALTER COLUMN priority SET DEFAULT 'medium';
ALTER TABLE tasks_task ALTER COLUMN "order" SET DEFAULT 0;
ALTER TABLE tasks_task ALTER COLUMN pr_url SET DEFAULT '';
ALTER TABLE tasks_task ALTER COLUMN qa_rejected SET DEFAULT false;
ALTER TABLE tasks_task ALTER COLUMN qa_rejection_reason SET DEFAULT '';
ALTER TABLE tasks_task ALTER COLUMN task_type SET DEFAULT 'task';
ALTER TABLE tasks_task ALTER COLUMN contract_compliance_score SET DEFAULT 0.0;
ALTER TABLE tasks_task ALTER COLUMN validation_contract SET DEFAULT '[]'::jsonb;
ALTER TABLE tasks_task ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE tasks_task ALTER COLUMN updated_at SET DEFAULT now();
"""

proc = subprocess.run(
    ["docker", "exec", "-i", "teamflow-db", "psql", "-U", "teamflow", "-d", "teamflow"],
    input=sql,
    text=True,
    capture_output=True,
)

print("STDOUT:\n", proc.stdout)
if proc.stderr:
    print("STDERR:\n", proc.stderr)
print("Return code:", proc.returncode)
