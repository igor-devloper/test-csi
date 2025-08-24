// app/api/diario/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canonicalName } from "@/lib/name"
import { getPrevDayKwhForSite } from "@/lib/csiEnergy"
import { getAllSystems, type SiteRow } from "@/lib/csiSites"

export const dynamic = "force-dynamic"

// ===================== CONFIG PHB ======================
const PHB_BASE = process.env.PHB_BASE_URL ?? "https://us.semportal.com"
const PHB_TOKEN = process.env.PHB_TOKEN // obrigatório
const PHB_REFERER = process.env.PHB_REFERER ?? "https://www.phbsolar.com.br"
// você pode apontar para o endpoint que retorna o JSON do seu print:
const PHB_LIST_PATH =
  process.env.PHB_LIST_PATH ?? "/api/PowerStationMonitor/QueryPowerStationMonitor"

// ======================== TIPOS =======================
type DbUsinaMinimal = { id: number; nome: string }

type Match = {
  dbId: number
  dbNome: string
  provider: "CSI" | "PHB"
  extId: number
  extNome: string
  clima?: string | null
}

type SiteRowExtra = Partial<{
  regionTimezone: string | null
  warningStatus: string | null
  businessWarningStatus: string | null
  incomeValue: number | null
  generationPower: number | null
  generationValue: number | null
  temperature: number | null
  lastUpdateTime: number | null
  weather: string | null
  networkStatus: string | null
}>
type SiteRowExt = SiteRow & SiteRowExtra

// ---------- PHB formato "novo" (seu exemplo) ----------
type PhbV2WeatherNow = {
  cloud?: string
  cond_code?: string
  cond_txt?: string // "Partly Cloudy"
  tmp?: string // "20"
}
type PhbV2Item = {
  powerstation_id: string // uuid
  stationname: string     // nome
  eday?: number           // kWh do dia
  emonth?: number
  eday_income?: number
  etotal?: number
  pac?: number            // W
  pac_kw?: number
  status?: number
  longitude?: string
  latitude?: string
  weather?: { HeWeather6?: Array<{ now?: PhbV2WeatherNow }> }
  org_name?: string
  to_hour?: number
  capacity?: number
  // ...demais campos ignorados
}

// ---------- PHB formato "antigo" (QueryPowerStationMonitor) ----------
type PhbV1Item = {
  id: number
  name: string
  weather?: string | null
  temperature?: number | null
  generationPower?: number | null
  generationValue?: number | null
  incomeValue?: number | null
  warningStatus?: string | null
  businessWarningStatus?: string | null
  networkStatus?: string | null
  lastUpdateTime?: number | null
  regionTimezone?: string | null
}

// ================ HELPERS ===================
function todayYMDInTZ(tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

const fromEpochSecs = (secs?: number | null) =>
  typeof secs === "number" && Number.isFinite(secs) ? new Date(secs * 1000) : null

// -------- PHB: chamada com headers esperados --------
async function phbFetch<T = any>(path: string, body: any): Promise<T> {
  if (!PHB_TOKEN) throw new Error("PHB_TOKEN ausente no ambiente")
  const res = await fetch(`${PHB_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Token": PHB_TOKEN,
      "Neutral": "1",
      "Referer": PHB_REFERER,
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`PHB ${path} ${res.status} - ${txt}`)
  }
  return res.json() as Promise<T>
}

/**
 * Normaliza a lista de usinas da PHB para um shape comum.
 * Aceita tanto o formato V1 (name/generationValue) quanto o V2 (stationname/eday).
 */
type PhbNormalized = {
  // id numérico (se não houver, gera um hash estável do uuid)
  id: number
  name: string
  kwhToday?: number | null
  income?: number | null
  powerW?: number | null
  temperatureC?: number | null
  weatherText?: string | null
  warningStatus?: string | null
  businessWarningStatus?: string | null
  networkStatus?: string | null
  lastUpdateTime?: number | null
  regionTimezone?: string | null
}

function stableHashToInt(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function mapPhbV2(item: PhbV2Item): PhbNormalized | null {
  const name = item.stationname?.trim()
  if (!name) return null
  const now = item.weather?.HeWeather6?.[0]?.now
  const tempC =
    typeof now?.tmp === "string" && now.tmp !== "" ? Number(now.tmp) : undefined
  return {
    id: stableHashToInt(item.powerstation_id || name),
    name,
    kwhToday: typeof item.eday === "number" ? item.eday : null,
    income: typeof item.eday_income === "number" ? item.eday_income : null,
    powerW: typeof item.pac === "number" ? item.pac : null,
    temperatureC: Number.isFinite(tempC) ? tempC! : null,
    weatherText: now?.cond_txt ?? null,
    warningStatus: String(item.status ?? ""),
    businessWarningStatus: null,
    networkStatus: null,
    lastUpdateTime: undefined,
    regionTimezone: undefined,
  }
}

function mapPhbV1(item: PhbV1Item): PhbNormalized | null {
  const name = item.name?.trim()
  if (!name) return null
  return {
    id: item.id,
    name,
    kwhToday: typeof item.generationValue === "number" ? item.generationValue : null,
    income: typeof item.incomeValue === "number" ? item.incomeValue : null,
    powerW: typeof item.generationPower === "number" ? item.generationPower : null,
    temperatureC: typeof item.temperature === "number" ? item.temperature : null,
    weatherText: item.weather ?? null,
    warningStatus: item.warningStatus ?? null,
    businessWarningStatus: item.businessWarningStatus ?? null,
    networkStatus: item.networkStatus ?? null,
    lastUpdateTime: item.lastUpdateTime ?? null,
    regionTimezone: item.regionTimezone ?? null,
  }
}

async function getAllPhbSystems(): Promise<PhbNormalized[]> {
  // payload genérico; ajuste se seu endpoint exigir filtros/paginação
  const payload = { pageIndex: 1, pageSize: 999 }
  const json: any = await phbFetch(PHB_LIST_PATH, payload)

  // Tente extrair lista de onde estiver
  const rawList: any[] =
    json?.data?.list ?? json?.data ?? json?.list ?? json?.rows ?? json ?? []

  const out: PhbNormalized[] = []
  for (const r of rawList) {
    if (r && (r.stationname || r.powerstation_id)) {
      const m = mapPhbV2(r as PhbV2Item)
      if (m) out.push(m)
      continue
    }
    if (r && (r.name || typeof r.id === "number")) {
      const m = mapPhbV1(r as PhbV1Item)
      if (m) out.push(m)
      continue
    }
  }
  return out
}

// ===================== ROTA GET =======================
export async function GET(req: Request) {
  // (opcional) chave de proteção
  const url = new URL(req.url)
  const key = url.searchParams.get("key")
  const expected = process.env.CRON_SECRET
  if (expected && key !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const ymd = todayYMDInTZ()
  const [Y, M, D] = ymd.split("-").map(Number)

  // 1) usinas do banco
  const dbUsinas: DbUsinaMinimal[] = await prisma.usina.findMany({
    select: { id: true, nome: true },
  })
  const byName = new Map(dbUsinas.map((u) => [canonicalName(u.nome), u]))

  // 2) provedores externos (CSI + PHB)
  const [csiRes, phbRes] = await Promise.allSettled([
    (async () => (await getAllSystems()) as SiteRowExt[])(),
    (async () => (await getAllPhbSystems()) as PhbNormalized[])(),
  ])
  const csiItems: SiteRowExt[] = csiRes.status === "fulfilled" ? csiRes.value : []
  const phbItems: PhbNormalized[] = phbRes.status === "fulfilled" ? phbRes.value : []

  const csiById = new Map<number, SiteRowExt>(csiItems.map((i) => [i.id, i]))
  const phbById = new Map<number, PhbNormalized>(phbItems.map((i) => [i.id, i]))

  // 3) casar por nome canônico (une CSI + PHB)
  const matches: Match[] = []
  const notFound: string[] = []
  const duplicateKeys: string[] = []
  const seen = new Set<string>()

  const push = (
    provider: "CSI" | "PHB",
    id: number,
    name: string,
    clima?: string | null
  ) => {
    const k = canonicalName(name ?? "")
    if (!k) return
    if (seen.has(k)) {
      duplicateKeys.push(`${name} (${provider})`)
      return
    }
    seen.add(k)
    const db = byName.get(k)
    if (db) {
      matches.push({
        dbId: db.id,
        dbNome: db.nome,
        provider,
        extId: id,
        extNome: name,
        clima: clima ?? null,
      })
    } else {
      notFound.push(`${name} (${provider})`)
    }
  }

  for (const it of csiItems) push("CSI", it.id, it.name ?? "", it.weather ?? null)
  for (const it of phbItems) push("PHB", it.id, it.name ?? "", it.weatherText ?? null)

  // 4) salvar
  let saved = 0
  const perItemErrors: Array<{
    usina: string
    provider: "CSI" | "PHB"
    extId: number
    error: string
  }> = []

  for (const m of matches) {
    let kwh: number | undefined

    // dados auxiliares por provider
    const sCSI = m.provider === "CSI" ? csiById.get(m.extId) : undefined
    const sPHB = m.provider === "PHB" ? phbById.get(m.extId) : undefined

    try {
      if (m.provider === "CSI") {
        // tenta detalhado; fallback na lista
        kwh = await getPrevDayKwhForSite(m.extId, Y, M, D, ymd)
        if (!Number.isFinite(kwh) && typeof sCSI?.generationValue === "number") {
          kwh = sCSI.generationValue!
        }
      } else {
        // PHB: usa eday/generationValue normalizados
        if (typeof sPHB?.kwhToday === "number") kwh = sPHB.kwhToday!
      }
    } catch {
      // segue para persistência com o que tiver
    }

    const tz = (sCSI?.regionTimezone ?? sPHB?.regionTimezone) ?? null
    const tmp =
      typeof sCSI?.temperature === "number" ? sCSI.temperature
      : typeof sPHB?.temperatureC === "number" ? sPHB.temperatureC
      : null
    const pwr =
      typeof sCSI?.generationPower === "number" ? sCSI.generationPower
      : typeof sPHB?.powerW === "number" ? sPHB.powerW
      : null
    const inc =
      typeof sCSI?.incomeValue === "number" ? sCSI.incomeValue
      : typeof sPHB?.income === "number" ? sPHB.income
      : null
    const warn = sCSI?.warningStatus ?? sPHB?.warningStatus ?? null
    const bwarn = sCSI?.businessWarningStatus ?? sPHB?.businessWarningStatus ?? null
    const net = sCSI?.networkStatus ?? sPHB?.networkStatus ?? null
    const upd = sCSI?.lastUpdateTime ?? sPHB?.lastUpdateTime ?? null
    const clima = m.clima ?? sCSI?.weather ?? sPHB?.weatherText ?? null

    if (Number.isFinite(kwh)) {
      try {
        await prisma.geracaoDiaria.upsert({
          where: { usinaId_data: { usinaId: m.dbId, data: new Date(ymd) } },
          create: {
            usinaId: m.dbId,
            data: new Date(ymd),
            energiaKwh: kwh!,
            clima,
            temperaturaC: tmp,
            potenciaW: pwr,
            rendaDia: inc,
            statusAviso: warn,
            statusNegocio: bwarn,
            statusRede: net,
            apiAtualizadoEm: fromEpochSecs(upd),
            timezone: tz,
          },
          update: {
            energiaKwh: kwh!,
            clima,
            temperaturaC: typeof tmp === "number" ? tmp : undefined,
            potenciaW: typeof pwr === "number" ? pwr : undefined,
            rendaDia: typeof inc === "number" ? inc : undefined,
            statusAviso: warn ?? undefined,
            statusNegocio: bwarn ?? undefined,
            statusRede: net ?? undefined,
            apiAtualizadoEm: fromEpochSecs(upd) ?? undefined,
            timezone: tz ?? undefined,
          },
        })
        saved++
        continue
      } catch (e: any) {
        perItemErrors.push({
          usina: m.dbNome,
          provider: m.provider,
          extId: m.extId,
          error: e?.message || String(e),
        })
        continue
      }
    }

    perItemErrors.push({
      usina: m.dbNome,
      provider: m.provider,
      extId: m.extId,
      error: "sem kWh",
    })
  }

  return NextResponse.json({
    ok: true,
    date: ymd,
    db_total: dbUsinas.length,
    csi_total: csiItems.length,
    phb_total: phbItems.length,
    matched: matches.length,
    saved,
    notFound,
    duplicateKeys,
    errors: perItemErrors,
  })
}
