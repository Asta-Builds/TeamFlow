import { createProject, expect, signIn, test, uniqueName } from './fixtures';

test.describe('Tickets', () => {
  test('a user adds a ticket to a project and finds it @smoke', async ({ page, account }) => {
    await signIn(page, account);
    const project = uniqueName('E2E Board');
    await createProject(page, project);

    await page.locator('a[href^="/projects/"]', { hasText: project }).first().click();
    await expect(page).toHaveURL(/\/projects\/[^/?#]+$/);

    const title = uniqueName('E2E ticket');
    await page.getByRole('button', { name: 'Create New Ticket' }).click();
    await page.getByPlaceholder('e.g. Implement user login with JWT').fill(title);
    await page.getByRole('button', { name: 'Create Ticket', exact: true }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    await page.getByPlaceholder('Search tickets by title...').fill(title);
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
