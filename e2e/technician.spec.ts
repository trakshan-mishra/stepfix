import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  // Exercise the real session endpoint and agent; the separate test worker uses
  // a mock provider and Cloudflare's public test key, never live LLM credentials.
  const response = await page.request.post("/api/session", {
    data: { turnstileToken: "test" }
  });
  expect(response.ok()).toBe(true);
  const { token, sessionId } = await response.json();
  expect(sessionId).toBeTruthy();
  await page.goto("/");
  await page.evaluate(
    ({ token, sessionId }) => {
      localStorage.setItem("stepfix:token", token);
      localStorage.setItem("stepfix:session", sessionId);
    },
    { token, sessionId }
  );
  await page.goto(`/session/${sessionId}`);
  const input = page.getByPlaceholder("Send a message...");
  await expect(input).toBeEnabled();
  await input.fill(
    "Ubuntu laptop: Wi-Fi shows connected but no websites load. It started this morning right after a system update."
  );
  await input.press("Enter");
  await expect(
    page.getByText("Test the internet connection by address", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paste output", exact: true })
  ).toBeEnabled();
}

async function paste(page: Page, output: string) {
  await page.getByRole("button", { name: "Paste output", exact: true }).click();
  await page.getByPlaceholder("Paste the command output here...").fill(output);
  await page.getByRole("button", { name: "Send output", exact: true }).click();
}

test("clarifies missing evidence, verifies the repair, downloads and preserves the summary", async ({
  page
}) => {
  await start(page);
  await page.getByRole("button", { name: "I ran it", exact: true }).click();
  await expect(
    page.getByText("More detail is needed. You can add the output here.")
  ).toBeVisible();
  await expect(
    page.getByText("Test that website names resolve (DNS)", { exact: true })
  ).toHaveCount(0);
  await paste(page, "4 packets transmitted, 4 received, 0% packet loss");
  await expect(
    page.getByText("Test that website names resolve (DNS)", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "It printed nothing", exact: true })
    .click();
  await expect(
    page.getByText("Clear the DNS cache", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByText("Test name lookup again", { exact: true })
  ).toBeVisible();
  await paste(page, "93.184.216.34 example.com");
  await expect(
    page.getByText("Try loading a website", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Fix summary", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Yes, the problem is fixed", exact: true })
    .click();
  await expect(page.getByText("Fix summary", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).click();
  expect((await download).suggestedFilename()).toBe("stepfix-summary.md");
  await page.reload();
  await expect(page.getByText("Fix summary", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Yes, the problem is fixed", exact: true })
  ).toHaveCount(0);
});

test("stopping produces a report and ends the session", async ({ page }) => {
  await start(page);
  await page
    .getByRole("button", { name: "Stop and get a report", exact: true })
    .click();
  await expect(
    page.getByText(/Troubleshooting ended\. Your report is ready/)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/ })).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toBeDisabled();
});
