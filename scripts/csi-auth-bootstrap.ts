import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = "https://webmonitoring-gl.csisolar.com";
const STORAGE = path.resolve(".auth/csi-storage.json");
const ENV = path.resolve(".env.local");

(async () => {
  if (!fs.existsSync(path.dirname(STORAGE))) fs.mkdirSync(path.dirname(STORAGE), { recursive: true });

  const first = !fs.existsSync(STORAGE);
  const browser = await chromium.launch({ headless: false });
  const context = first ? await browser.newContext() : await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  if (first) {
    console.log("Faça login na janela e navegue até a home…");
    try { await page.waitForLoadState("networkidle", { timeout: 90_000 }); } catch {}
    await context.storageState({ path: STORAGE });
  }

  const state = JSON.parse(fs.readFileSync(STORAGE, "utf-8"));

  // Monta Cookie:
  const cookies = (state.cookies || []).filter((c: any) => c.domain.includes("csisolar.com"));
  const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");

  // Procura Bearer (se o app usar):
  let bearer: string | undefined;
  for (const origin of state.origins || []) {
    if (!origin.origin.includes("csisolar.com")) continue;
    for (const kv of origin.localStorage || []) {
      const k = String(kv.name || "").toLowerCase();
      if (k.includes("token") || k.includes("auth") || k.includes("jwt")) {
        try {
          const val = JSON.parse(kv.value);
          bearer = typeof val === "string" ? val : (val.access_token || val.token || val.value);
        } catch { bearer = kv.value; }
      }
    }
  }

  // Atualiza .env.local
  let current = "";
  try { current = fs.readFileSync(ENV, "utf-8"); } catch {}
  const withoutOld = current.replace(/^CSI_COOKIE=.*$/m, "").replace(/^CSI_BEARER=.*$/m, "").trim();
  const lines = [
    `CSI_COOKIE=${cookieHeader}`,
    bearer ? `CSI_BEARER=${bearer}` : undefined,
  ].filter(Boolean).join("\n") + "\n";
  fs.writeFileSync(ENV, (withoutOld ? withoutOld + "\n" : "") + lines);

  console.log("✔ Sessão capturada. CSI_COOKIE " + (bearer ? "e CSI_BEARER " : "") + "gravados.");
  await browser.close();
})();
