// lib/csiHistory.ts
import axios from "axios";
import { CSI_BASE, portalHeaders } from "./csiClient";

/** Item retornado pela API de histórico da CSI */
export type CsiMonthDay = {
  acceptDay: string;        // "YYYYMMDD"
  generationValue?: number | null; // kWh do dia
  fullPowerHoursDay?: number | null;
};

/** Normaliza "YYYYMMDD" -> "YYYY-MM-DD" */
export function ymdFromAcceptDay(s: string): string {
  if (!s || s.length !== 8) return "";
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

/** Busca o histórico diário (kWh) da usina para (ano, mês). */
export async function csiGetMonthHistory(siteId: number, year: number, month: number, bearer?: string) {
  const url = `${CSI_BASE}/maintain-s/history/power/${siteId}/stats/month?year=${year}&month=${month}`;
  const headers = portalHeaders({ bearer });

  const { data } = await axios.get<{ records?: CsiMonthDay[] }>(url, {
    headers,
    timeout: 30_000,
    validateStatus: s => s >= 200 && s < 500
  });

  const list = Array.isArray(data?.records) ? data!.records! : [];
  // transforma em { date: "YYYY-MM-DD", kwh: number }
  return list
    .map(d => {
      const date = ymdFromAcceptDay(d.acceptDay);
      const kwh  = typeof d.generationValue === "number" ? d.generationValue : null;
      return { date, kwh };
    })
    .filter(x => x.date && typeof x.kwh === "number");
}
