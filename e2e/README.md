# TeamFlow end-to-end tests

Playwright drives the real stack through a browser: Next.js, then NestJS, then Postgres (migrated by
Django). Nothing is mocked, so an agent cannot pass these tests by faking its own mistakes. This is
Phase 2 of the factory plan.

- **Every PR** runs the `@smoke` journeys and the screenshot checks (`.github/workflows/e2e.yml`).
- **Every night** (03:00 UTC) the full suite runs against `main`.

## Critical user journeys

These are the paths that must never break. A change that breaks one is a release blocker.

| # | Journey | Test | Runs |
|---|---|---|---|
| 1 | A new user signs up and lands on the dashboard | `accounts.spec.ts` | every PR |
| 2 | A signed-out visitor is sent to the login page | `accounts.spec.ts` | every PR |
| 3 | A user signs in, signs out, and stays out | `accounts.spec.ts` | every PR |
| 4 | A wrong password does not sign anyone in | `accounts.spec.ts` | nightly |
| 5 | A user creates a project and finds it by search | `projects.spec.ts` | every PR |
| 6 | Another organization never sees a team's project | `projects.spec.ts` | nightly |
| 7 | A user adds a ticket to a project and finds it | `tickets.spec.ts` | every PR |

Not covered yet:
- **The agent swarm and its live reasoning feed (SSE).** These need the Django engine and a language model. They'll be covered once a stub model can stand in for the real one in CI.
- **Billing.** This needs a payment provider in test mode.
- **Inviting a teammate.** This needs a way to read the invitation email.

## Screenshot checks

`visual.spec.ts` compares full-page screenshots, with a 1% pixel tolerance, animations off, and per-run
details like the user's name masked.

- **First run of a new screen**: there's no baseline yet, so the test records one and passes. CI
  uploads it as the `visual-baselines` artifact.
- **Starting the comparison**: download that artifact and commit its files under
  `e2e/tests/__screenshots__/linux/`. From then on, any visual change fails the check, and the
  `playwright-report` artifact shows the expected image, the actual image and the diff.
- **Intended change**: delete the old baseline, let CI record a new one, and commit it.

Baselines are per platform (fonts render differently), so CI only compares against the `linux` ones.

## Running locally

1. Start TeamFlow as usual (Postgres, Django migrations, NestJS on 8001, Next.js on 3000).
2. Run:

```bash
cd e2e
npm ci
npx playwright install chromium
npm run test:smoke                                  # or: npm test
E2E_BASE_URL=http://localhost:3000 npm test         # if the app runs elsewhere
```

Every test creates its own throwaway account (`e2e-<id>@example.test`) with a random password, so
the suite can run against any non-production database without cleanup. Never run it against
production.
