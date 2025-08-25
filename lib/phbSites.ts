// lib/phbSites.ts
import axios from "axios";
import { PHB_BASE, phbBaseHeaders } from "./phbClient";

export type PhbStation = {
  powerstation_id: string;
  stationname: string;
  location?: string | null;
  status?: number | null;
  pac?: number | null;
  pac_kw?: number | null;
  capacity?: number | null;
  eday?: number | null;
  eday_income?: number | null;
  emonth?: number | null;
  etotal?: number | null;
  to_hour?: number | null;
  longitude?: string | null;
  latitude?: string | null;
  currency?: string | null;
  yield_rate?: number | null;
  weather?: any | null;
  org_name?: string | null;
};

type PhbResponse = {
  hasError: boolean;
  code: number;
  msg: string;
  data?: { record: number; list: PhbStation[] };
};

function payloadFromDevtools(page_index = 1, page_size = 14) {
  // Se quiser forçar um org_id, defina PHB_ORG_ID no .env
  const org_id = process.env.PHB_ORG_ID ?? "";
  return {
    adcode: "",
    condition: "",
    key: "",
    orderby: "",
    org_id,             // <- igual ao print (string vazia se não tiver)
    page_index,
    page_size: Number(process.env.PHB_PAGE_SIZE ?? page_size),
    powerstation_id: "",
    powerstation_status: "",
    powerstation_type: "",
  };
}

export function phbExtractWeatherInfo(w: any): { cond?: string | null; tempC?: number | null } {
  try {
    const now = w?.HeWeather6?.[0]?.now;
    const cond = now?.cond_txt ?? null;
    const tmp  = now?.tmp;
    const tempC = typeof tmp === "string" ? Number(tmp) : (typeof tmp === "number" ? tmp : null);
    return { cond: cond ?? null, tempC: Number.isFinite(tempC as any) ? (tempC as number) : null };
  } catch { return { cond: null, tempC: null }; }
}

export async function phbGetAllStations(): Promise<PhbStation[]> {
  const url = `${PHB_BASE}/api/PowerStationMonitor/QueryPowerStationMonitor`;
  const headers = phbBaseHeaders();

  const out: PhbStation[] = [];
  const pageSize = Number(process.env.PHB_PAGE_SIZE ?? 14);
  let page = 1;

  while (true) {
    const payload = payloadFromDevtools(page, pageSize);
    const { data } = await axios.post<PhbResponse>(url, payload, { headers });

    // Diagnóstico leve: se a API retornar code != 0 ou hasError, não “falha silenciosamente”
    if (data?.hasError || data?.code !== 0) {
      console.warn("[PHB] resposta não OK:", { code: data?.code, msg: data?.msg });
      break; // evita loop infinito
    }

    const list = data?.data?.list ?? [];
    out.push(...list);

    // fim da paginação
    if (list.length < pageSize) break;
    page++;
    if (page > 200) break; // guard rail
  }

  return out;
}
