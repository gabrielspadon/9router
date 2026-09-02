// The one smoke spec: log in through the real form and prove the dashboard
// shell actually rendered. Everything here is asserted against the running
// application, not a mock.
//
// It exists so the e2e harness is a working example rather than an empty
// folder. A UI change that breaks the login form, the redirect, or the shell
// makes this red; anything narrower belongs in its own spec.
import { expect, test } from 'playwright/test';

const PASSWORD = process.env.SMOKE_PASSWORD || '123456';

test.describe('dashboard smoke', () => {
  test('logs in and renders the dashboard shell', async ({ page }) => {
    await page.goto('/login');

    // The form itself, by its accessible handles rather than by CSS classes,
    // which the UI work in flight is actively rewriting.
    const password = page.locator('#password');
    await expect(password).toBeVisible();
    await password.fill(PASSWORD);
    await page.getByRole('button', { name: /log ?in/i }).click();

    // The redirect is part of the contract: a wrong password leaves you on
    // /login, so reaching /dashboard is itself the assertion that auth worked.
    await page.waitForURL(/\/dashboard/);

    // The shell rendered, not just the route resolved. A client-side crash
    // still gives a /dashboard URL with an empty body, so assert on content.
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // The sidebar is the shell's navigation. Providers is the page every other
    // dashboard route is reachable from, so its absence means the shell is
    // broken even when the page area painted.
    await expect(page.locator('nav a[href="/dashboard/providers"]').first()).toBeVisible();

    // Nothing in the shell should have thrown on the way here.
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/dashboard/providers');
    await expect(page).toHaveURL(/\/dashboard\/providers/);
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('rejects a wrong password and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: /log ?in/i }).click();
    // Give the request time to land and the redirect time to not happen.
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login/);
  });

  test('xAI exposes none reasoning without appending it to model names', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: /log ?in/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto('/dashboard/providers/xai');
    const thinking = page.getByTitle('Appends (level) suffix to copied model names');
    await expect(thinking).toBeVisible();
    await expect(thinking.locator('option[value="none"]')).toHaveText('Thinking: None');

    await thinking.selectOption('none');
    await expect(page.getByText('xai/grok-4', { exact: true })).toBeVisible();
    await expect(page.getByText(/\(none\)/)).toHaveCount(0);
  });
});
