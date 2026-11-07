import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export interface Account {
  email: string;
  password: string;
  name: string;
  organization: string;
}

/** A brand-new account, so tests never share state and can run in parallel. */
export function newAccount(): Account {
  const id = randomUUID().slice(0, 8);
  return {
    email: `e2e-${id}@example.test`,
    // Generated per run: no credential ever lives in the repo.
    password: `${randomUUID()}Aa1!`,
    name: `E2E User ${id}`,
    organization: `E2E Org ${id}`,
  };
}

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('name@company.example').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole('button', { name: 'Sign in to Workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Creates a project from the Projects page and waits until it is listed. */
export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects Portfolio' })).toBeVisible();
  await page.getByRole('button', { name: 'New Project' }).click();
  await page.getByPlaceholder('e.g. Next-Gen Mobile App').fill(name);
  // Never provision a real GitHub repository from a test.
  await page.getByLabel('DevOps Agent: Automatically provision & link GitHub repository').uncheck();
  await page.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

/** Unique, readable names for things a test creates. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** Registers a fresh account through the API, which is faster than the sign-up form. */
export async function registerAccount(request: APIRequestContext): Promise<Account> {
  const account = newAccount();
  const res = await request.post('/api/auth/register', {
    data: {
      email: account.email,
      name: account.name,
      password: account.password,
      organization_name: account.organization,
    },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return account;
}

export const test = base.extend<{ account: Account }>({
  /** The sign-up journey itself goes through the UI; every other test starts from this. */
  account: async ({ request }, use) => {
    await use(await registerAccount(request));
  },
});

export { expect };
