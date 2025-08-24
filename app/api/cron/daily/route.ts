// app/api/diario/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canonicalName } from "@/lib/name"
import { getPrevDayKwhForSite } from "@/lib/csiEnergy"
import { getAllSystems, type SiteRow } from "@/lib/csiSites"

export const dynamic = "force-dynamic"

// ===== PHB CONFIG =====
const PHB_BASE = process.env.PHB_BASE_URL ?? "https://us.semportal.com"
const PHB_TOKEN = process.env.PHB_TOKEN
const PHB_REFERER = process.env.PHB_REFERER ?? "https://www.phbsolar.com.br"
const PHB_LIST_PATH =
  process.env.PHB_LIST_PATH ?? "/api/PowerStationMonitor/QueryPowerStationMonitor"

// ===== TIPOS =====
type DbUsinaMinimal = { id: number; nome: string }
type Provider = "CSI" | "PHB"

type Match = {
  dbId: number
  dbNome: string
  provider: Provider
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

// PHB v2 (stationname/eday)
type PhbV2WeatherNow = {
  cloud?: string
  cond_code?: string
  cond_txt?: string
  tmp?: string // string numérica
}
type PhbV2Item = {
  powerstation_id: string
  stationname: string
  eday?: number
  eday_income?: number
  pac?: number
  status?: number
  weather?: { HeWeather6?: Array<{ now?: PhbV2WeatherNow }> }
  lastUpdateTime?: number
  regionTimezone?: string
}

// PHB v1 (name/generationValue)
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

type PhbNormalized = {
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

// ===== HELPERS =====
function ymdInTZ(offsetDays = 0, tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  const now = new Date()
  const ymdToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
  const d = new Date(`${ymdToday}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const fromEpochSecs = (secs?: number | null) =>
  typeof secs === "number" && Number.isFinite(secs) ? new Date(secs * 1000) : null

function coalesceDayKwhFromCSI(s?: any): number | null {
  const cands = [
    s?.generationValue,
    s?.todayEnergy,
    s?.eday,
    s?.dayGeneration,
    s?.dayEnergy,
  ]
  for (const v of cands) {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  }
  return null
}

function stableHashToInt(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// ===== PHB FETCH / NORMALIZAÇÃO =====
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
    warningStatus: item.status != null ? String(item.status) : null,
    businessWarningStatus: null,
    networkStatus: null,
    lastUpdateTime: item.lastUpdateTime ?? null,
    regionTimezone: item.regionTimezone ?? null,
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

async function getAllPhbSystems(): Promise<{ items: PhbNormalized[]; rawCount: number }> {
  const payload = { pageIndex: 1, pageSize: 999 }
  const json: any = await phbFetch(PHB_LIST_PATH, payload)
  const rawList: any[] =
    json?.data?.list ?? json?.data ?? json?.list ?? json?.rows ?? (Array.isArray(json) ? json : [])
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
  return { items: out, rawCount: Array.isArray(rawList) ? rawList.length : 0 }
}

// ====== ROTA ======
export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get("key")
  const expected = process.env.CRON_SECRET
  if (expected && key !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  // escolher data: default = yesterday
  const dayParam = url.searchParams.get("day") // today | yesterday
  const ymdBase = dayParam === "today" ? ymdInTZ(0) : ymdInTZ(-1)
  const candidates = [ymdBase, ymdInTZ(-2), ymdInTZ(0)] // ontem -> anteontem -> hoje

  // banco
  const dbUsinas: DbUsinaMinimal[] = await prisma.usina.findMany({
    select: { id: true, nome: true },
  })
  const byName = new Map(dbUsinas.map((u) => [canonicalName(u.nome), u]))

  // provedores
  const [csiRes, phbRes] = await Promise.allSettled([
    (async () => (await getAllSystems()) as SiteRowExt[])(),
    (async () => await getAllPhbSystems())(),
  ])
  const csiItems: SiteRowExt[] = csiRes.status === "fulfilled" ? csiRes.value : []
  const phbPack = phbRes.status === "fulfilled" ? phbRes.value : { items: [], rawCount: 0 }
  const phbItems: PhbNormalized[] = phbPack.items
  const phb_raw_count = phbPack.rawCount

  const csiById = new Map<number, SiteRowExt>(csiItems.map((i) => [i.id, i]))
  const phbById = new Map<number, PhbNormalized>(phbItems.map((i) => [i.id, i]))

  // casar
  const matches: Match[] = []
  const notFound: string[] = []
  const duplicateKeys: string[] = []
  const seen = new Set<string>()

  const push = (provider: Provider, id: number, name: string, clima?: string | null) => {
    const k = canonicalName(name ?? "")
    if (!k) return
    if (seen.has(k)) {
      duplicateKeys.push(`${name} (${provider})`)
      return
    }
    seen.add(k)
    const db = byName.get(k)
    if (db) {
      matches.push({ dbId: db.id, dbNome: db.nome, provider, extId: id, extNome: name, clima: clima ?? null })
    } else {
      notFound.push(`${name} (${provider})`)
    }
  }

  for (const it of csiItems) push("CSI", it.id, it.name ?? "", it.weather ?? null)
  for (const it of phbItems) push("PHB", it.id, it.name ?? "", it.weatherText ?? null)

  // salvar
  let saved = 0
  const perItemErrors: Array<{ usina: string; provider: Provider; extId: number; error: string }> = []
  const debugCSI: any[] = []

  for (const m of matches) {
    let persisted = false

    for (const ymd of candidates) {
      let kwh: number | undefined
      const [Y, M, D] = ymd.split("-").map(Number)

      const sCSI = m.provider === "CSI" ? csiById.get(m.extId) : undefined
      const sPHB = m.provider === "PHB" ? phbById.get(m.extId) : undefined

      try {
        if (m.provider === "CSI") {
          kwh = await getPrevDayKwhForSite(m.extId, Y, M, D, ymd)
          if (!Number.isFinite(kwh)) {
            const alt = coalesceDayKwhFromCSI(sCSI)
            if (typeof alt === "number") kwh = alt
          }
        } else {
          if (typeof sPHB?.kwhToday === "number") kwh = sPHB.kwhToday!
        }
      } catch {
        // segue para tentar com fallback
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
          persisted = true
          break
        } catch (e: any) {
          perItemErrors.push({ usina: m.dbNome, provider: m.provider, extId: m.extId, error: e?.message || String(e) })
          persisted = true // já tentou salvar, não repete
          break
        }
      }
    }

    if (!persisted) {
      // loga amostra de campos do CSI pra debug
      if (m.provider === "CSI") {
        const s = (csiById.get(m.extId) ?? {}) as any
        if (debugCSI.length < 3) {
          const { id, name, generationValue, todayEnergy, eday, dayGeneration, dayEnergy } = s
          debugCSI.push({ id, name, generationValue, todayEnergy, eday, dayGeneration, dayEnergy })
        }
      }
      perItemErrors.push({ usina: m.dbNome, provider: m.provider, extId: m.extId, error: "sem kWh" })
    }
  }

  return NextResponse.json({
    ok: true,
    date: ymdBase,
    db_total: dbUsinas.length,
    csi_total: csiItems.length,
    phb_total: phbItems.length,
    phb_raw_count,
    matched: matches.length,
    saved,
    notFound,
    duplicateKeys,
    errors: perItemErrors,
    debug: { csi_examples: debugCSI },
  })
}
