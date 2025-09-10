// lib/phbHistory.ts
import axios from "axios";
import { PHB_TZ, PHB_TOKEN, PHB_ORIGIN, PHB_REFERER, PHB_COOKIE } from "./phbClient";

/** Base HTTPS do endpoint de charts (sem :82) */
export const PHB_CHARTS_BASE = process.env.PHB_CHARTS_BASE ?? "https://us.semsportal.com";

type PhbChartResp = {
  code?: string | number;
  hasError?: boolean;
  data?: {
    leftLabels?: Array<{ label: string }>;
    lines?: Array<{
      name?: string;             // ex.: "PVGeneration"
      label?: string;            // "Generation (kWh)"
      unit?: string;             // "kWh"
      xy?: Array<{ x: string; y: number | null; z?: any }>; // x = "YYYY-MM-DD"
    }>;
  };
};

function phbChartsHeaders() {
  const h: Record<string, string> = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    Origin: PHB_ORIGIN,
    Referer: PHB_REFERER,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
  if (PHB_COOKIE) h["Cookie"] = PHB_COOKIE;
  // ATENÇÃO: aqui é 'token' minúsculo
  if (PHB_TOKEN) h["token"] = PHB_TOKEN;
  // alguns tenants exigem esse header extra observado no DevTools
  if (process.env.PHB_NEUTRAL === "1") h["neutral"] = "1";
  return h;
}

/**
 * Busca a série diária do gráfico "PVGeneration" (kWh) a partir do endpoint Charts.
 * A PHB devolve um range deslizante; usamos `date` como "ancora" (tipicamente o último dia do mês).
 *
 * @param stationId  powerstation_id (string)
 * @param dateISO    "YYYY-MM-DD" usado no payload
 * @param range      2 (conforme DevTools)
 * @param chartIndex "3" (conforme DevTools)
 */
export async function phbGetDailySeries(
  stationId: string,
  dateISO: string,
  range = 2,
  chartIndex = "3"
): Promise<Array<{ date: string; kwh: number }>> {
  const url = `${PHB_CHARTS_BASE}/api/v2/Charts/GetChartByPlant`;
  const headers = phbChartsHeaders();
  const payload = {
    id: stationId,
    date: dateISO,
    range,
    chartIndexId: chartIndex,
    isDetailFull: "",
  };

  const { data } = await axios.post<PhbChartResp>(url, payload, {
    headers,
    timeout: 30_000,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  const ok = data && (data.code === "0" || data.code === 0) && !data.hasError;
  if (!ok) return [];

  const line = (data.data?.lines || []).find(
    (l) =>
      (l.name || "").toLowerCase().includes("pvgeneration") ||
      (l.label || "").toLowerCase().includes("generation")
  );
  if (!line?.xy?.length) return [];

  return line.xy
    .map((p) => ({
      date: p.x, // já vem "YYYY-MM-DD"
      kwh: typeof p.y === "number" ? p.y : NaN,
    }))
    .filter((r) => r.date && Number.isFinite(r.kwh));
}

/** Retorna "YYYY-MM-DD" do último dia do mês em TZ Americas/Sao_Paulo (ok usar UTC também). */
export function endOfMonthISO(year: number, month: number): string {
  // new Date(UTC, nextMonth, 0) -> último dia do mês
  const d = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Busca a série PHB, mas **filtra** para manter apenas os pontos do mês (year, month).
 * Usamos `endOfMonthISO` como âncora para cobrir todo o mês via range deslizante.
 */
export async function phbGetMonthHistory(
  stationId: string,
  year: number,
  month: number
): Promise<Array<{ date: string; kwh: number }>> {
  const endISO = endOfMonthISO(year, month);
  const series = await phbGetDailySeries(stationId, endISO, 2, "3");
  const ym = `${year}-${String(month).padStart(2, "0")}-`;
  return series.filter((r) => r.date.startsWith(ym));
}
