// lib/phbClient.ts
import type { AxiosRequestHeaders } from "axios";

export const PHB_BASE   = process.env.PHB_BASE   ?? "http://us.semsportal.com:82"; // <- http:82
export const PHB_TZ     = process.env.PHB_TZ     ?? "America/Sao_Paulo";

export const PHB_COOKIE = process.env.PHB_COOKIE ?? "";
export const PHB_TOKEN  = (process.env.PHB_TOKEN ?? "").trim();      // header "Token" (JWT)
export const PHB_BEARER = (process.env.PHB_BEARER ?? "").trim();     // raramente usado
export const PHB_ORIGIN = process.env.PHB_ORIGIN ?? "https://www.phbsolar.com.br";
export const PHB_REFERER= process.env.PHB_REFERER?? "https://www.phbsolar.com.br/";

// alguns tenants são chatos com cabeçalhos "Sec-Fetch-*"
export function phbBaseHeaders(): AxiosRequestHeaders {
  const h: Record<string, string> = {
    Accept: "application/json, */*; q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    Origin: PHB_ORIGIN,
    Referer: PHB_REFERER,
    "X-Requested-With": "XMLHttpRequest",
    Connection: "keep-alive",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Dest": "empty",
  };
  if (PHB_COOKIE)  h["Cookie"] = PHB_COOKIE;
  if (PHB_TOKEN)   h["Token"]  = PHB_TOKEN; // <- exatamente “Token”
  if (PHB_BEARER)  h["Authorization"] = PHB_BEARER.startsWith("Bearer") ? PHB_BEARER : `Bearer ${PHB_BEARER}`;
  return h as any;
}
