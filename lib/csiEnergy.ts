// lib/csiEnergy.ts
import axios from "axios";

/** Resolve um origin válido do próprio app (prod, vercel ou localhost). */
function getBaseOrigin() {
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  // fallback para dev local
  return (env ? env.replace(/\/+$/, "") : "http://localhost:3000");
}

/**
 * Busca o kWh do dia para a usina `siteId`.
 * - Se `dateYMD` vier (YYYY-MM-DD), usa direto.
 * - Caso contrário, monta a data a partir de (y, m, d).
 */
export async function getPrevDayKwhForSite(
  siteId: number,
  y: number,
  m: number,
  d: number,
  dateYMD = ""
) {
  const ymd =
    dateYMD ||
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const base = getBaseOrigin();
  const url = `${base}/api/csi/day?site=${encodeURIComponent(
    siteId
  )}&date=${encodeURIComponent(ymd)}`;

  const res = await axios.get<{ kwh: number }>(url, {
    headers: { Accept: "application/json" },
    timeout: 30_000,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (!res.data || typeof res.data.kwh !== "number") {
    throw new Error(`sem kWh (site ${siteId})`);
  }

  return res.data.kwh;
}
