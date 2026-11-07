import { expect, signIn, test } from './fixtures';

/**
 * Screenshot comparisons. A screen's first CI run records its baseline (see
 * playwright.config.ts); after the baseline is committed, any visual change
 * fails here and the HTML report shows expected, actual and the diff.
 */
test.describe('Visual', () => {
  test('the login page @smoke @visual', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in to Workspace' })).toBeVisible();
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('an empty projects page @visual', async ({ page, account }) => {
    await signIn(page, account);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects Portfolio' })).toBeVisible();
    // The account's name and organization differ every run.
    await expect(page).toHaveScreenshot('projects-empty.png', {
      fullPage: true,
      mask: [
        page.getByLabel('User profile settings'),
        page.getByLabel('View My Profile'),
        page.getByText(account.organization),
      ],
    });
  });
});
