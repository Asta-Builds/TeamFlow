import { defineRailway, github, postgres, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const repo = "Asta-Builds/TeamFlow";
  const backendSource = github(repo, { checkSuites: false, rootDirectory: "./backend" });
  const frontendSource = github(repo, { checkSuites: false, rootDirectory: "./frontend" });
  const nestSource = github(repo, { checkSuites: false, rootDirectory: "./backend-nest" });
  const nginxSource = github(repo, { checkSuites: false, rootDirectory: "./nginx" });

  const teamflowDb = postgres("teamflow-db", { region: "sfo" });
  const teamflowRedis = redis("teamflow-redis", { region: "sfo" });
  teamflowRedis.deploy = {
    startCommand:
      "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"",
  };

  const teamflowDbVolume = volume("teamflow-db-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "sfo",
    sizeMB: 500,
  });

  const teamflowRedisVolume = volume("teamflow-redis-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "sfo",
    sizeMB: 500,
  });

  // Persistent volume for agent git workspaces attached strictly to the worker
  const teamflowGeneratedProjects = volume("teamflow-generated-projects", {
    region: "sfo",
    sizeMB: 1024,
  });

  const teamflowBackend = service("teamflow-backend", {
    source: backendSource,
    healthcheck: "/api/health/",
    replicas: { sfo: 1 },
    env: {
      AGENT_REQUIRE_RELEASE_APPROVAL: preserve(),
      AGENT_VERIFY_EXECUTOR: "github_actions",
      ALLOWED_HOSTS: preserve(),
      CELERY_BROKER_URL: preserve(),
      CORS_ALLOWED_ORIGINS: preserve(),
      CSRF_TRUSTED_ORIGINS: preserve(),
      DATABASE_URL: preserve(),
      DEBUG: preserve(),
      DEPLOY_CALLBACK_BASE_URL: preserve(),
      DEPLOY_HOOK_TOKEN: preserve(),
      DEPLOY_HOOK_URL: preserve(),
      DJANGO_SUPERUSER_EMAIL: preserve(),
      DJANGO_SUPERUSER_PASSWORD: preserve(),
      FRONTEND_URL: preserve(),
      GEMINI_API_KEY: preserve(),
      PORT: preserve(),
      PYTHON_AI_JWT_SECRET: preserve(),
      REDIS_URL: preserve(),
      SECRET_KEY: preserve(),
      SEED_DEMO_DATA: preserve(),
    },
  });

  const teamflowCelery = service("teamflow-celery", {
    source: backendSource,
    start: "celery -A teamflow worker --loglevel=info --concurrency=2",
    replicas: { sfo: 1 },
    volumeMounts: {
      "/workspace/generated_projects": teamflowGeneratedProjects,
    },
    env: {
      AGENT_REQUIRE_RELEASE_APPROVAL: preserve(),
      AGENT_VERIFY_EXECUTOR: "github_actions",
      APP_ROLE: preserve(),
      CELERY_BROKER_URL: preserve(),
      C_FORCE_ROOT: preserve(),
      DATABASE_URL: preserve(),
      DEBUG: preserve(),
      DEPLOY_HOOK_TOKEN: preserve(),
      DEPLOY_HOOK_URL: preserve(),
      DJANGO_SECRET_KEY: preserve(),
      GEMINI_API_KEY: preserve(),
      PYTHON_AI_JWT_SECRET: preserve(),
      PYTHONWARNINGS: preserve(),
      REDIS_URL: preserve(),
      SECRET_KEY: preserve(),
    },
  });

  const teamflowFrontend = service("teamflow-frontend", {
    source: frontendSource,
    replicas: { sfo: 1 },
    env: {
      NEXT_PUBLIC_API_URL: preserve(),
      PORT: preserve(),
    },
  });

  const teamflowBackendNest = service("teamflow-backend-nest", {
    source: nestSource,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/api/health",
    replicas: { sfo: 1 },
    env: {
      AGENT_EMAIL_DOMAIN: preserve(),
      CORS_ALLOWED_ORIGINS: preserve(),
      DATABASE_URL: teamflowDb.env.DATABASE_URL,
      DEPLOY_HOOK_TOKEN: preserve(),
      DEPLOY_HOOK_URL: preserve(),
      FRONTEND_URL: preserve(),
      JWT_REFRESH_SECRET: preserve(),
      JWT_SECRET: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      PYTHON_AI_JWT_SECRET: preserve(),
      PYTHON_AI_SERVICE_URL: "http://teamflow-backend.railway.internal:8000",
    },
  });

  // teamflow-nginx is the single public service routing all ingress traffic.
  // Note: Railway IaC does not support registering domains (neither generated *.up.railway.app
  // nor custom domains via authoring). Adding domains: [...] fails during planning with:
  // "Custom-domain registration is not supported by Railway configuration. Add in the dashboard, then run railway config pull."
  // Generated Railway service domains are omitted from authoring per Railway specification.
  // To assign a public domain, run `railway domain --service teamflow-nginx` after apply.
  const teamflowNginx = service("teamflow-nginx", {
    source: nginxSource,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/nginx-health",
    replicas: { sfo: 1 },
    env: {
      ADMIN_ALLOWED_IPS: preserve(),
      BACKEND_HOST: preserve(),
      FRONTEND_HOST: preserve(),
      NEST_HOST: preserve(),
      PORT: preserve(),
    },
  });

  return project("eloquent-nourishment", {
    resources: [
      teamflowDb,
      teamflowBackend,
      teamflowCelery,
      teamflowRedis,
      teamflowFrontend,
      teamflowBackendNest,
      teamflowNginx,
      teamflowDbVolume,
      teamflowRedisVolume,
      teamflowGeneratedProjects,
    ],
  });
});
