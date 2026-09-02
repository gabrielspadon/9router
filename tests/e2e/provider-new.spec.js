import { expect, test } from "playwright/test";

const PASSWORD = process.env.SMOKE_PASSWORD || "123456";

test("selects a catalog provider and opens its non-destructive connection step", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /log ?in/i }).click();
  await page.waitForURL(/\/dashboard/);

  const providerMutations = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/providers") && !["GET", "HEAD"].includes(request.method())) {
      providerMutations.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto("/dashboard/providers/new");
  await expect(page.getByRole("heading", { name: "Connect a Provider" })).toBeVisible();
  await expect(page.getByText("Provider not found")).toHaveCount(0);
  const provider = page.getByLabel("Provider", { exact: true });
  const continueButton = page.getByRole("button", { name: "Continue to connection" });
  await expect(provider).toBeVisible();
  await expect(continueButton).toBeDisabled();

  await provider.selectOption({ label: "OpenAI" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page).toHaveURL(/\/dashboard\/providers\/openai$/);
  await expect(page.getByRole("heading", { level: 1, name: "OpenAI" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();

  const addConnection = page.getByRole("button", { name: /^(Add Connection|Add)$/ }).last();
  await expect(addConnection).toBeVisible();
  await addConnection.click();

  const dialog = page.getByRole("dialog", { name: "Add OpenAI API Key" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("E2E review only");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(providerMutations).toEqual([]);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});
