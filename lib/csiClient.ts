// lib/csiClient.ts
import type { AxiosRequestHeaders } from "axios";

export const CSI_BASE = process.env.CSI_BASE ?? "https://webmonitoring-gl.csisolar.com";
export const CSI_COOKIE = process.env.CSI_COOKIE ?? "";
export const CSI_TZ = process.env.CSI_TZ ?? "America/Sao_Paulo";

export function baseHeaders(): AxiosRequestHeaders {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (CSI_COOKIE) h["Cookie"] = CSI_COOKIE;
  return h as any;
}

export function portalHeaders(opts?: { bearer?: string }): AxiosRequestHeaders {
  const raw = (opts?.bearer || process.env.CSI_BEARER || "").trim();
  const bearer = raw ? (raw.startsWith("Bearer") ? raw : `Bearer ${raw}`) : "";
  const h: Record<string, string> = { ...((baseHeaders() as unknown) as Record<string, string>) };
  if (bearer) h["Authorization"] = bearer;
  h["Referer"] = `${CSI_BASE}/maintain/home`;
  return h as any;
}
