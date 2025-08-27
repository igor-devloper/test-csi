// lib/growattPlants.ts
import axios from "axios";
import { URLSearchParams } from "url";
import { GROWATT_BASE, growattHeaders } from "./growattClient";

export type GrowattPlant = {
  id: string;
  plantName: string;
  eToday?: string | null;      // kWh (string)
  currentPac?: string | null;  // kW (string)
  onlineNum?: string | null;   // "2"
  plantType?: string | null;
};

type GrowattResp = {
  currPage?: number;
  pages?: number;
  pageSize?: number;
  count?: number;
  datas?: GrowattPlant[];
  notPager?: boolean;
};

function makeForm(currPage: number, name = "", pageSize = 20): URLSearchParams {
  const fd = new URLSearchParams();
  // Iguais ao DevTools
  fd.set("currPage", String(currPage));
  fd.set("plantType", "-1");
  fd.set("orderType", "2");
  fd.set("plantName", name);
  // alguns backends exigem explicitamente:
  fd.set("pageSize", String(pageSize));
  return fd;
}

// Pede JSON mesmo quando o backend responde text/plain
function parseMaybeJson(data: any): GrowattResp {
  if (data && typeof data === "object") return data as GrowattResp;
  if (typeof data === "string") {
    try { return JSON.parse(data) as GrowattResp; } catch { /* ignore */ }
  }
  return { pages: 1, datas: [] };
}

export async function growattGetAllPlants(): Promise<GrowattPlant[]> {
  const headers = growattHeaders();
  const candidates = [
    `${GROWATT_BASE}/selectPlant/getPlantListAjax`, // mais comum
    `${GROWATT_BASE}/selectPlant/plantListAjax`,    // variação
    `${GROWATT_BASE}/selectPlant/getPlantList`,     // variação
    `${GROWATT_BASE}/selectPlant`,                  // fallback
  ];

  const out: GrowattPlant[] = [];
  let page = 1;
  const HARD_LIMIT = 100;
  const size = 20;

  // escolhe o primeiro endpoint que não dá 405/404
  let workingUrl: string | null = null;

  // testa a primeira página em cada candidato até um responder OK
  for (const url of candidates) {
    try {
      const body = makeForm(1, "", size).toString();
      const res = await axios.post(url, body, { headers, validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        // ok
        workingUrl = url;
        const first = parseMaybeJson(res.data);
        const list = first?.datas ?? [];
        out.push(...list);
        const totalPages = Number(first?.pages ?? 1);
        if (totalPages <= 1 || list.length === 0) return out;
        page = 2; // já temos a página 1
        // continua paginação com a mesma URL
        while (page <= totalPages && page <= HARD_LIMIT) {
          const b = makeForm(page, "", size).toString();
          const { data, status } = await axios.post(workingUrl, b, { headers });
          if (status < 200 || status >= 300) break;
          const resp = parseMaybeJson(data);
          const lst = resp?.datas ?? [];
          out.push(...lst);
          if (!lst.length) break;
          page++;
        }
        return out;
      } else {
        // log leve de diagnóstico
        if (process.env.SEP_LOG === "1") {
          console.log(`[GROWATT] ${url} -> status ${res.status}`);
        }
      }
    } catch (e: any) {
      if (process.env.SEP_LOG === "1") {
        console.log(`[GROWATT] erro em ${url}:`, e?.response?.status || e?.message);
      }
    }
  }

  // se chegou aqui, nenhum endpoint serviu
  if (process.env.SEP_LOG === "1") {
    console.error("[GROWATT] Nenhum endpoint aceitou a requisição (405/404?). Verifique o COOKIE e a URL do tenant.");
  }
  return out;
}
