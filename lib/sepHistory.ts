// lib/sepHistory.ts
import axios from "axios";
import { SEP_BASE, sepHeaders, SEP_TZ } from "./sepClient";

/**
 * Endpoint observado (DevTools):
 *   GET /api/bps/plant/power/histogram?type=1&date=YYYY-MM
 *
 * Observações:
 *  - "date" é ano-mês (YYYY-MM)
 *  - "type" pode variar por tenant; parametrizei via env SEP_HIST_TYPE (default 1)
 *  - Retorno: { code, msg, data: [{ data: number, time: "YYYY-MM-DD", unit: "kWh" }, ...] }
 */
export async function sepGetMonthHistory(
  plantId: string | number,
  year: number,
  month: number
): Promise<Array<{ date: string; kwh: number }>> {
  // Alguns tenants exigem o plantId no header/path; neste endpoint o plantId vem via query na instância
  // que você mostrou (o host já "sabe" qual planta está selecionada). Para robustez,
  // vamos enviar o plantId também em headers quando suportado por proxy/tenant.
  const headers = {
    ...sepHeaders(),
    // Envie um header auxiliar (ignorado se o backend não usa):
    "X-Plant-Id": String(plantId),
  } as any;

  const typeParam = Number(process.env.SEP_HIST_TYPE ?? 1);
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const url = `${SEP_BASE}/api/bps/plant/power/histogram`;
  const { data } = await axios.get(url, {
    headers,
    params: { type: typeParam, date: ym },
    // Alguns tenants só entregam se houver cookie/bearer no sepHeaders()
    validateStatus: (s) => s >= 200 && s < 500,
  });

  const arr: Array<{ data?: number; time?: string }> = data?.data ?? [];
  return (Array.isArray(arr) ? arr : [])
    .map((it) => ({
      date: typeof it.time === "string" ? it.time : "",
      kwh: typeof it.data === "number" ? it.data : NaN,
    }))
    .filter((x) => x.date && Number.isFinite(x.kwh));
}

/**
 * Janela de meses desde abril até o mês atual (inclusive).
 * - Se hoje for Jan/Fev/Mar, pega abril do ANO ANTERIOR até o mês atual do ANO ATUAL.
 * - Caso contrário, pega abril do ANO ATUAL até o mês atual.
 */
export function monthsSinceApril(base = new Date()): Array<{ y: number; m: number }> {
  const todayY = base.getUTCFullYear();
  const todayM = base.getUTCMonth() + 1;

  const out: Array<{ y: number; m: number }> = [];
  let y: number, startM: number, endY: number, endM: number;

  if (todayM >= 4) {
    // Abril..mês atual do mesmo ano
    y = todayY;
    startM = 4;
    endY = todayY;
    endM = todayM;
  } else {
    // Abril do ano anterior..mês atual do ano atual
    y = todayY - 1;
    startM = 4;
    endY = todayY;
    endM = todayM;
  }

  for (let yy = y; yy <= endY; yy++) {
    const mStart = yy === y ? startM : 1;
    const mEnd = yy === endY ? endM : 12;
    for (let mm = mStart; mm <= mEnd; mm++) out.push({ y: yy, m: mm });
  }
  return out;
}

export { SEP_TZ };
