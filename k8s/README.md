# Kubernetes manifests (not maintained)

These manifests predate the NestJS API, the Celery worker split, and the current
nginx routing. They route `/api` to Django and do not deploy `backend-nest` or the
worker, so they do not produce a working TeamFlow installation.

Use `docker-compose.prod.yml` and `docs/PREPROD_RUNBOOK.md` instead, or rebuild
these manifests from the compose file before using them.
