const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:4010";
const outputDir = path.resolve(__dirname, "..", ".qa", "capacity");
fs.mkdirSync(outputDir, { recursive: true });

const environments = [
  { name: "pegada", path: "/pegada/" },
  { name: "florybal", path: "/florybal/" },
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function inspect(browser, environment, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText || ""}`));

  await page.goto(`${baseUrl}${environment.path}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.getByRole("button", { name: "Eficiência de capacidade" }).click();
  await page.waitForSelector(".capacity-layout", { timeout: 120000 });
  await page.waitForTimeout(1000);

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const zoom = Number.parseFloat(getComputedStyle(body).zoom) || 1;
    const contentWidth = Math.max(body.scrollWidth, root.scrollWidth) * zoom;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clippedText = [...document.querySelectorAll(".capacity-layout strong, .capacity-layout span, .capacity-layout small, .capacity-layout li")]
      .filter((element) => visible(element) && element.textContent.trim())
      .filter((element) => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
      .map((element) => element.textContent.trim().replace(/\s+/g, " ").slice(0, 120));
    return {
      horizontalOverflow: contentWidth > root.clientWidth + 2,
      scrollY: window.scrollY,
      kpiCount: document.querySelectorAll(".capacity-kpi").length,
      chartCount: document.querySelectorAll(".capacity-layout svg.recharts-surface").length,
      chartMarks: document.querySelectorAll(".capacity-layout .recharts-bar-rectangle path, .capacity-layout .recharts-scatter-symbol").length,
      coloredRows: document.querySelectorAll(".capacity-row-critical, .capacity-row-risk, .capacity-row-demand, .capacity-row-balanced, .capacity-row-selected").length,
      clippedText,
      hasResponsibleReading: document.body.innerText.includes("Leitura gerencial do filtro"),
      hasNormalizedComparison: document.body.innerText.includes("Comparativo normalizado por filial"),
    };
  });

  const filename = `${environment.name}-${viewport.name}.png`;
  await page.evaluate(() => document.querySelector(".capacity-layout")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: false });
  let download = null;
  if (viewport.name === "desktop") {
    const downloadEvent = page.waitForEvent("download", { timeout: 120000 });
    await page.getByRole("button", { name: "Excel" }).click();
    const file = await downloadEvent;
    const target = path.join(outputDir, `${environment.name}-capacity.xlsx`);
    await file.saveAs(target);
    download = { filename: path.basename(target), size: fs.statSync(target).size };
  }
  await context.close();
  return { environment: environment.name, viewport: viewport.name, ...metrics, errors, screenshot: filename, download };
}

(async () => {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  try {
    const results = [];
    for (const environment of environments) {
      for (const viewport of viewports) results.push(await inspect(browser, environment, viewport));
    }
    const report = { generatedAt: new Date().toISOString(), baseUrl, results };
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2));
    const failed = results.some((item) => item.errors.length || item.horizontalOverflow || item.scrollY > 2 || item.kpiCount !== 5 || item.chartCount < 2 || item.chartMarks === 0 || item.coloredRows === 0 || item.clippedText.length || !item.hasResponsibleReading || !item.hasNormalizedComparison || (item.viewport === "desktop" && !item.download?.size));
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
