// lib/sepClient.ts
import type { AxiosRequestHeaders } from "axios";

export const SEP_BASE    = process.env.SEP_BASE    ?? "https://sep-api.csisolar.com";
export const SEP_TZ      = process.env.SEP_TZ      ?? "America/Sao_Paulo";
export const SEP_BEARER  = (process.env.SEP_BEARER ?? "").trim();
export const SEP_ORIGIN  = process.env.SEP_ORIGIN  ?? "https://smartenergy-gl.csisolar.com";
export const SEP_REFERER = process.env.SEP_REFERER ?? "https://smartenergy-gl.csisolar.com/";

export function sepHeaders(): AxiosRequestHeaders {
  const h: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: SEP_ORIGIN,
    Referer: SEP_REFERER,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  };
  if (SEP_BEARER) h.Authorization = SEP_BEARER.startsWith("Bearer") ? SEP_BEARER : `Bearer ${SEP_BEARER}`;
  // ⚠️ nesse backend a key é exatamente "appVersion"
  if (process.env.SEP_APPVERSION) h["appVersion"] = process.env.SEP_APPVERSION!;
  return h as any;
}
