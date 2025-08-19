// lib/csiSites.ts
import axios from "axios";
import { CSI_BASE, portalHeaders } from "./csiClient";

export type SiteRow = {
  id: number;
  name?: string;
  locationAddress?: string;
  weather?: string;
  temperature?: number;
  networkStatus?: string;
  generationPower?: number;
  generationValue?: number;
  installedCapacity?: number;
  lastUpdateTime?: number;
};

const DEFAULT_PAYLOAD = {
  powerTypeList: ["PV"],
  region: { level1: null, level2: null, level3: null, level4: null, level5: null, nationId: null },
  tagId: null,
  keyword: null,
};

async function fetchPage(page: number, size = 200, bearer?: string) {
  const rel = `/maintain-s/operating/station/search?page=${page}&size=${size}&order.direction=ASC&order.property=name`;
  const url = `${CSI_BASE}${rel}`;
  const headers = portalHeaders({ bearer });

  try {
    const res = await axios.post<{ total: number; data: SiteRow[] }>(url, DEFAULT_PAYLOAD, { headers });
    const body: any = res.data || {};
    return { total: body.total ?? (body.data?.length || 0), data: (body.data ?? []) as SiteRow[] };
  } catch {
    const res = await axios.get<{ total: number; data: SiteRow[] }>(url, { headers });
    const body: any = res.data || {};
    return { total: body.total ?? (body.data?.length || 0), data: (body.data ?? []) as SiteRow[] };
  }
}

export async function getAllSystems(bearer?: string): Promise<SiteRow[]> {
  const tok = bearer || process.env.CSI_BEARER || "";
  let page = 1, size = 200;
  let out: SiteRow[] = [];
  let { total, data } = await fetchPage(page, size, tok);
  out.push(...data);
  while (out.length < (total || 0) && data.length > 0) {
    page++;
    ({ total, data } = await fetchPage(page, size, tok));
    out.push(...data);
  }
  return out;
}
