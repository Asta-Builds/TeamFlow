import { createProject, expect, registerAccount, signIn, test, uniqueName } from './fixtures';

test.describe('Projects', () => {
  test('a user creates a project and finds it by search @smoke', async ({ page, account }) => {
    await signIn(page, account);
    const name = uniqueName('E2E Project');
    await createProject(page, name);

    const search = page.getByPlaceholder('Search projects...');
    await search.fill(name);
    await expect(page.getByText(name).first()).toBeVisible();

    await search.fill('no project has this name');
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("another organization never sees a team's project", async ({ page, account, browser }) => {
    await signIn(page, account);
    const name = uniqueName('E2E Private Project');
    await createProject(page, name);

    // An unrelated account, in its own browser context (separate storage).
    const context = await browser.newContext();
    try {
      const outsiderPage = await context.newPage();
      const outsider = await registerAccount(context.request);
      await signIn(outsiderPage, outsider);
      await outsiderPage.goto('/projects');
      await expect(outsiderPage.getByRole('heading', { name: 'Projects Portfolio' })).toBeVisible();
      await expect(outsiderPage.getByText(name)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
