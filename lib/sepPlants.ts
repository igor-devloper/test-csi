// lib/sepPlants.ts
import axios from "axios";
import { SEP_BASE, sepHeaders } from "./sepClient";

export type SepPlant = {
  plantId: number | string;
  plantName: string;
  capacity?: number | null;
  realTimePower?: number | null;  // kW
  dayElectric?: number | null;    // kWh
  monthElectric?: number | null;  // MWh
  yearElectric?: number | null;   // MWh
  totalElectric?: number | null;  // MWh
  timeZone?: string | null;
  lastReportTimeOrigin?: string | null;
  lastReportTime?: string | null;
  weatherLabel?: string | null;
  status?: number | null;         // 1 online
  statusName?: string | null;
};

type SepEnvelope =
  | { code?: number; msg?: string; data?: any }
  | { data?: { list?: any[]; records?: any[]; rows?: any[] } }
  | any[];

function extractList(payload: any): SepPlant[] {
  if (Array.isArray(payload)) return payload as SepPlant[];
  const d = payload?.data;
  if (d?.list && Array.isArray(d.list)) return d.list as SepPlant[];
  if (d?.records && Array.isArray(d.records)) return d.records as SepPlant[];
  if (d?.rows && Array.isArray(d.rows)) return d.rows as SepPlant[];
  if (Array.isArray(d)) return d as SepPlant[];
  return [];
}

// 👉 exatamente como no DevTools (com o wrapper "data")
function makePayload(currentPage: number, pageSize: number) {
  const baseData = {
    area: null,
    city: null,
    country: null,
    favorite: null,
    plantName: "",
    plantTypes: null,
    province: null,
    queryCapacityMax: null,
    queryCapacityMin: null,
    status: null,
    street: null,
    systemTypes: null,
    tagId: [] as any[],
  };

  // permite forçar payload via .env se precisar
  const raw = (process.env.SEP_PAYLOAD ?? "").trim();
  let dataObj = baseData;
  if (raw) {
    try { dataObj = { ...baseData, ...JSON.parse(raw) }; } catch {}
  }

  return {
    currentPage,
    pageSize,
    orderByPropertyName: null,
    orderByRule: 2, // mesmo que no print
    data: dataObj,
  };
}

export async function sepGetAllPlants(): Promise<SepPlant[]> {
  const url = `${SEP_BASE}/api/bps/plant/page`;
  const headers = sepHeaders();
  const out: SepPlant[] = [];
  const size = Number(process.env.SEP_PAGE_SIZE ?? 20);

  let page = 1;
  const HARD_LIMIT = 200;

  while (page <= HARD_LIMIT) {
    const payload = makePayload(page, size);
    const { data } = await axios.post<SepEnvelope>(url, payload, { headers });
    const list = extractList(data);
    if (process.env.SEP_LOG === "1") {
      console.log(`[SEP] page=${page} -> ${list.length} items`);
    }
    out.push(...list);
    if (list.length < size) break; // última página
    page++;
  }

  return out;
}
