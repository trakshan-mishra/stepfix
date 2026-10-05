import { access } from "node:fs/promises";
import { chromium } from "playwright-core";

const APP_URL = "http://localhost:5173";
const FALLBACK_CHROMIUM =
  "/home/trakshan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const SUPPORT_REQUEST =
  "Ubuntu laptop: Wi-Fi shows connected but no websites load. It started this morning right after a system update.";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function appIsRunning() {
  try {
    const response = await fetch(APP_URL, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function hasBackupMode(page) {
  return page
    .locator("body")
    .innerText()
    .then((text) => text.toLowerCase().includes("[backup mode"));
}

async function waitForFirstCardOrBackup(page) {
  return page.waitForFunction(
    () => {
      if (document.body.innerText.toLowerCase().includes("[backup mode")) {
        return "backup";
      }

      const elements = [...document.querySelectorAll("button, summary")];
      return elements.some((element) =>
        ["Copy", "What you should see"].includes(
          element.textContent?.trim() ?? ""
        )
      )
        ? "ready"
        : false;
    },
    undefined,
    { timeout: 60_000 }
  );
}

async function waitForNextReplyOrCard(page, assistantReplyCount) {
  return page.waitForFunction(
    (previousReplyCount) => {
      if (document.body.innerText.toLowerCase().includes("[backup mode")) {
        return "backup";
      }

      const hasNextCard = [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Didn't work"
      );
      const hasNextReply =
        document.querySelectorAll(".sd-theme").length > previousReplyCount;
      const isStreaming = document.querySelector(
        'button[aria-label="Stop generation"]'
      );
      return (hasNextCard || hasNextReply) && !isStreaming ? "ready" : false;
    },
    assistantReplyCount,
    { timeout: 60_000 }
  );
}

if (!(await appIsRunning())) {
  console.error("Start the app first: npm run dev");
  process.exit(1);
}

const bundledChromium = chromium.executablePath();
const executablePath = (await exists(bundledChromium))
  ? bundledChromium
  : FALLBACK_CHROMIUM;

if (!(await exists(executablePath))) {
  throw new Error(`Chromium executable not found: ${executablePath}`);
}

let browser;

try {
  browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    executablePath
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("stepfix:token");
    localStorage.removeItem("stepfix:session");
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Start a support session" }).click();

  const messageBox = page.getByPlaceholder("Send a message...");
  await messageBox.waitFor({ state: "visible" });
  await messageBox.pressSequentially(SUPPORT_REQUEST, { delay: 40 });
  await messageBox.press("Enter");

  const firstCardState = await waitForFirstCardOrBackup(page);
  if (firstCardState === "backup") {
    console.error("Groq rate limited, wait 60s and run again");
    process.exitCode = 1;
  } else {
    await page.waitForTimeout(3000);
    await page.getByText("Why this?", { exact: true }).last().click();
    await page.waitForTimeout(3000);
    await page.getByText("What you should see", { exact: true }).last().click();
    await page.waitForTimeout(3000);

    const assistantReplyCount = await page.locator(".sd-theme").count();
    const failedButton = page
      .getByRole("button", { name: "Didn't work", exact: true })
      .last();
    await failedButton.click();
    await page
      .getByText("result recorded", { exact: false })
      .last()
      .waitFor({ state: "visible" });
    const nextReplyState = await waitForNextReplyOrCard(
      page,
      assistantReplyCount
    );
    if (nextReplyState === "backup") {
      console.error("Groq rate limited, wait 60s and run again");
      process.exitCode = 1;
    } else {
      await page.waitForTimeout(6000);
      if (await hasBackupMode(page)) {
        console.error("Groq rate limited, wait 60s and run again");
        process.exitCode = 1;
      } else {
        await page.locator(".flex-1.overflow-y-auto").evaluate((element) => {
          element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
        });
        await page.waitForTimeout(5000);
      }
    }
  }
} finally {
  await browser?.close();
}
