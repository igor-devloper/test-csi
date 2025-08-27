// lib/growattClient.ts
import type { AxiosRequestHeaders } from "axios";

export const GROWATT_BASE    = process.env.GROWATT_BASE    ?? "https://server.growatt.com";
export const GROWATT_TZ      = process.env.GROWATT_TZ      ?? "America/Sao_Paulo";
// copie do DevTools (JSESSIONID, assToken, etc.)
export const GROWATT_COOKIE  = (process.env.GROWATT_COOKIE ?? "").trim();
export const GROWATT_REFERER = process.env.GROWATT_REFERER ?? "https://server.growatt.com/selectPlant";

export function growattHeaders(): AxiosRequestHeaders {
  const h: Record<string, string> = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: GROWATT_BASE,
    Referer: GROWATT_REFERER,
    Connection: "keep-alive",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  };
  if (GROWATT_COOKIE) h["Cookie"] = GROWATT_COOKIE;
  return h as any;
}
