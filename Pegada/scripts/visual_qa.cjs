const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4001/pegada/";
const outputDir = path.resolve(__dirname, "..", "qa");
fs.mkdirSync(outputDir, { recursive: true });

const tabSlugs = [
  "overview",
  "movement",
  "overtime",
  "attendance",
  "certificates",
  "variables",
  "charges",
  "benefits",
  "provisions",
  "vacation-schedule",
  "rubrics",
  "imports",
  "access",
];

async function pageMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clippedText = [...document.querySelectorAll("button, th, td, strong, span")]
      .filter((element) => visible(element) && element.textContent.trim())
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.overflowX === "hidden" && element.scrollWidth > element.clientWidth + 2;
      })
      .slice(0, 20)
      .map((element) => element.textContent.trim().replace(/\s+/g, " ").slice(0, 100));
    const zoom = Number.parseFloat(getComputedStyle(body).zoom) || 1;
    const contentWidth = Math.max(body.scrollWidth, root.scrollWidth) * zoom;
    return {
      title: document.title,
      bodyWidth: Math.round(contentWidth),
      viewportWidth: root.clientWidth,
      horizontalOverflow: contentWidth > root.clientWidth + 2,
      scrollY: window.scrollY,
      clippedText,
      mainTextLength: document.querySelector(".workspace")?.innerText.length || 0,
      chartCount: document.querySelectorAll("svg.recharts-surface").length,
    };
  });
}

async function inspectViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText || ""}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".nav button", { timeout: 120000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Carregando dados da folha"), null, { timeout: 120000 });
  await page.waitForTimeout(1000);

  const nav = page.locator(".nav button");
  const count = await nav.count();
  const tabs = [];
  for (let index = 0; index < count; index += 1) {
    await page.evaluate((shouldScroll) => window.scrollTo(0, shouldScroll ? Math.min(650, document.body.scrollHeight) : 0), index > 0);
    await nav.nth(index).click();
    await page.waitForTimeout(250);
    const slug = tabSlugs[index] || `tab-${index + 1}`;
    const metrics = await pageMetrics(page);
    tabs.push({ slug, ...metrics });
    if (["overview", "overtime", "provisions", "vacation-schedule", "imports"].includes(slug)) {
      await page.screenshot({ path: path.join(outputDir, `${name}-${slug}-fold.png`), fullPage: false });
    }
  }

  await nav.first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, `${name}-overview.png`), fullPage: true });

  let download = null;
  if (name === "desktop") {
    const excelButton = page.getByRole("button", { name: "Excel" });
    const downloadEvent = page.waitForEvent("download", { timeout: 120000 });
    await excelButton.click();
    const file = await downloadEvent;
    const target = path.join(outputDir, "BI-Pegada-QA.xlsx");
    await file.saveAs(target);
    download = { suggestedFilename: file.suggestedFilename(), path: target, size: fs.statSync(target).size };
  }

  await context.close();
  return { name, viewport, navCount: count, tabs, errors, download };
}

(async () => {
  const installedChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
  });
  try {
    const desktop = await inspectViewport(browser, "desktop", { width: 1440, height: 900 });
    const mobile = await inspectViewport(browser, "mobile", { width: 390, height: 844 });
    const report = { baseUrl, generatedAt: new Date().toISOString(), desktop, mobile };
    fs.writeFileSync(path.join(outputDir, "visual-qa.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2));
    const problems = [desktop, mobile].flatMap((result) => [
      ...result.errors,
      ...result.tabs.filter((tab) => tab.horizontalOverflow).map((tab) => `${result.name}/${tab.slug}: horizontal overflow`),
      ...result.tabs.filter((tab) => tab.scrollY > 2).map((tab) => `${result.name}/${tab.slug}: opened at scrollY ${tab.scrollY}`),
      ...result.tabs.flatMap((tab) => tab.clippedText.map((text) => `${result.name}/${tab.slug}: clipped ${text}`)),
    ]);
    if (desktop.navCount !== tabSlugs.length || mobile.navCount !== tabSlugs.length || problems.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
