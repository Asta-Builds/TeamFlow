import { expect, newAccount, signIn, test } from './fixtures';

test.describe('Accounts', () => {
  test('a new user signs up and lands on the dashboard @smoke', async ({ page }) => {
    const account = newAccount();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByPlaceholder('Alex Morgan').fill(account.name);
    await page.getByPlaceholder('Acme Corp').fill(account.organization);
    await page.getByPlaceholder('name@company.example').fill(account.email);
    await page.locator('input[type="password"]').fill(account.password);
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByLabel('Primary Navigation')).toBeVisible();
  });

  test('a signed-out visitor is sent to the login page @smoke', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in to Workspace' })).toBeVisible();
  });

  test('a user signs in, signs out, and stays out @smoke', async ({ page, account }) => {
    await signIn(page, account);
    await page.getByRole('button', { name: 'Sign out of workspace' }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a wrong password does not sign anyone in', async ({ page, account }) => {
    await page.goto('/login');
    await page.getByPlaceholder('name@company.example').fill(account.email);
    await page.locator('input[type="password"]').fill(`${account.password}-wrong`);
    await page.getByRole('button', { name: 'Sign in to Workspace' }).click();

    // The form stays put and nothing is stored for the session.
    await expect(page.getByRole('button', { name: 'Sign in to Workspace' })).toBeEnabled();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
