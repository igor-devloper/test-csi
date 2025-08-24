import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canonicalName } from "@/lib/name"
import { getPrevDayKwhForSite } from "@/lib/csiEnergy"
import { getAllSystems, type SiteRow } from "@/lib/csiSites"

type DbUsinaMinimal = { id: number; nome: string }

type Match = {
  dbId: number
  dbNome: string
  csiId: number
  csiNome: string
  clima?: string | null
}

export const dynamic = "force-dynamic"

/** Y-M-D em um fuso específico (default: America/Sao_Paulo) */
function todayYMDInTZ(tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/** Campos extras que a API realmente retorna, mas não estão no tipo SiteRow gerado */
type SiteRowExtra = Partial<{
  regionTimezone: string | null
  warningStatus: string | null
  businessWarningStatus: string | null
  incomeValue: number | null
  generationPower: number | null   // W (instantâneo)
  generationValue: number | null   // kWh no dia
  temperature: number | null       // °C
  lastUpdateTime: number | null    // epoch seconds
  weather: string | null
}>

type SiteRowExt = SiteRow & SiteRowExtra

/** Converte epoch seconds -> Date (ou null) */
const fromEpochSecs = (secs?: number | null) =>
  typeof secs === "number" && Number.isFinite(secs) ? new Date(secs * 1000) : null

export async function GET(req: Request) {
  // chave opcional
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

  // 2) usinas do portal
  const csiItems = (await getAllSystems()) as SiteRowExt[]
  const csiById = new Map<number, SiteRowExt>(csiItems.map((i) => [i.id, i]))

  // 3) casar por nome canônico
  const matches: Match[] = []
  const notFound: string[] = []
  const duplicateKeys: string[] = []
  const seen = new Set<string>()

  for (const it of csiItems) {
    const k = canonicalName(it.name ?? "")
    if (!k) continue
    if (seen.has(k)) {
      duplicateKeys.push(it.name ?? `id:${it.id}`)
      continue
    }
    seen.add(k)

    const db = byName.get(k)
    if (db) {
      matches.push({
        dbId: db.id,
        dbNome: db.nome,
        csiId: it.id,
        csiNome: it.name ?? "",
        clima: it.weather ?? null,
      })
    } else {
      notFound.push(it.name ?? `id:${it.id}`)
    }
  }

  // 4) salvar
  let saved = 0
  const perItemErrors: Array<{
    usina: string
    csiId: number
    error: string
    csi?: SiteRowExt
  }> = []

  for (const m of matches) {
    let kwh: number | undefined
    try {
      kwh = await getPrevDayKwhForSite(m.csiId, Y, M, D, ymd)
    } catch {}

    const snap = csiById.get(m.csiId)

    if (!Number.isFinite(kwh)) {
      const alt = snap?.generationValue ?? null
      if (typeof alt === "number" && Number.isFinite(alt)) kwh = alt
    }

    if (Number.isFinite(kwh)) {
      try {
        await prisma.geracaoDiaria.upsert({
          where: { usinaId_data: { usinaId: m.dbId, data: new Date(ymd) } },
          create: {
            usinaId: m.dbId,
            data: new Date(ymd),
            energiaKwh: kwh!,
            clima: m.clima ?? snap?.weather ?? null,

            // novos campos
            temperaturaC: typeof snap?.temperature === "number" ? snap!.temperature! : null,
            potenciaW: typeof snap?.generationPower === "number" ? snap!.generationPower! : null,
            rendaDia: typeof snap?.incomeValue === "number" ? snap!.incomeValue! : null,
            statusAviso: snap?.warningStatus ?? null,
            statusNegocio: snap?.businessWarningStatus ?? null,
            statusRede: snap?.networkStatus ?? null,
            apiAtualizadoEm: fromEpochSecs(snap?.lastUpdateTime),
            timezone: snap?.regionTimezone ?? null,
          },
          update: {
            energiaKwh: kwh!,
            clima: m.clima ?? snap?.weather ?? null,
            temperaturaC: typeof snap?.temperature === "number" ? snap!.temperature! : undefined,
            potenciaW: typeof snap?.generationPower === "number" ? snap!.generationPower! : undefined,
            rendaDia: typeof snap?.incomeValue === "number" ? snap!.incomeValue! : undefined,
            statusAviso: snap?.warningStatus ?? undefined,
            statusNegocio: snap?.businessWarningStatus ?? undefined,
            statusRede: snap?.networkStatus ?? undefined,
            apiAtualizadoEm: fromEpochSecs(snap?.lastUpdateTime) ?? undefined,
            timezone: snap?.regionTimezone ?? undefined,
          },
        })
        saved++
        continue
      } catch (e: any) {
        perItemErrors.push({
          usina: m.dbNome,
          csiId: m.csiId,
          error: e?.message || String(e),
          csi: snap,
        })
        continue
      }
    }

    perItemErrors.push({
      usina: m.dbNome,
      csiId: m.csiId,
      error: "sem kWh",
      csi: snap,
    })
  }

  return NextResponse.json({
    ok: true,
    date: ymd,
    db_total: dbUsinas.length,
    csi_total: csiItems.length,
    matched: matches.length,
    saved,
    notFound,
    duplicateKeys,
    perItemErrors,
  })
}
