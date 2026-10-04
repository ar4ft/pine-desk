import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const out = process.argv[2] ?? "test-results/design";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
for (const theme of ["dark", "light"]) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("http://127.0.0.1:5173/");
  await page.locator('[data-page="workspace"]').click();
  await page.locator("#pine-editor .cm-content").waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `workspace-${theme}.png`) });
  await page.locator("#focus-chart").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `focus-${theme}.png`) });
  await page.keyboard.press("Escape");
  await page.locator(".workspace-utilities").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, `tools-${theme}.png`) });
  for (const section of [
    "education",
    "backtest",
    "crypto",
    "settings",
    "orderflow",
    "options",
    "library",
    "edge",
    "whale",
    "mcp",
  ]) {
    await page.locator(`[data-page="${section}"]`).click();
    if (await page.evaluate(() => window.scrollY !== 0))
      throw new Error(`Navigation retained scroll in ${section}/${theme}`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, `${section}-${theme}.png`) });
  }
}
const names = [
  "workspace",
  "focus",
  "tools",
  "education",
  "backtest",
  "crypto",
  "settings",
  "orderflow",
  "options",
  "library",
  "edge",
  "whale",
  "mcp",
].flatMap((section) => ["dark", "light"].map((theme) => `${section}-${theme}`));
const sheet = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pine Desk design review</title><style>body{margin:0;padding:32px;background:#edf1f4;color:#24313d;font:14px system-ui}h1{font-size:28px;margin:0 0 8px}p{margin:0 0 24px}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}figure{margin:0}img{display:block;width:100%;border:1px solid #c9d2db;box-sizing:border-box}figcaption{padding:8px 0}</style><h1>Pine Desk · optical bench</h1><p>Desktop browser captures, 1440 × 1000. Synthetic demonstration data. Open individual PNGs to inspect detail.</p><main>${names.map((name) => `<figure><img src="${name}.png" alt="${name.replaceAll("-", " ")}"><figcaption>${name.replaceAll("-", " ")}</figcaption></figure>`).join("")}</main></html>`;
await fs.writeFile(path.join(out, "sheet.html"), sheet);
let rendered = sheet;
for (const name of names) {
  const png = await fs.readFile(path.join(out, `${name}.png`));
  rendered = rendered.replace(
    `src="${name}.png"`,
    `src="data:image/png;base64,${png.toString("base64")}"`,
  );
}
await page.setViewportSize({ width: 1800, height: 1000 });
await page.setContent(rendered);
await page.screenshot({ path: path.join(out, "sheet.png"), fullPage: true });
await browser.close();
