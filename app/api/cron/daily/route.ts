import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canonicalName } from "@/lib/name"
import { getPrevDayKwhForSite } from "@/lib/csiEnergy"
import { getAllSystems, type SiteRow } from "@/lib/csiSites"

import { phbGetAllStations, phbExtractWeatherInfo, type PhbStation } from "@/lib/phbSites"
import { sepGetAllPlants, SepPlant } from "@/lib/sepPlants"

type DbUsinaMinimal = { id: number; nome: string }

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

/** Converte epoch seconds -> Date (ou null) */
const fromEpochSecs = (secs?: number | null) =>
  typeof secs === "number" && Number.isFinite(secs) ? new Date(secs * 1000) : null

export async function GET(req: Request) {
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

  /* ========= BLOCO CSI ========= */
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

  const csiItems = (await getAllSystems()) as SiteRowExt[]
  const csiById = new Map<number, SiteRowExt>(csiItems.map((i) => [i.id, i]))

  const csiMatches: Array<{ dbId: number; dbNome: string; csiId: number; csiNome: string; clima?: string | null }> = []
  const csiNotFound: string[] = []
  const csiDuplicateKeys: string[] = []
  const csiSeen = new Set<string>()

  for (const it of csiItems) {
    const k = canonicalName(it.name ?? "")
    if (!k) continue
    if (csiSeen.has(k)) {
      csiDuplicateKeys.push(it.name ?? `id:${it.id}`)
      continue
    }
    csiSeen.add(k)
    const db = byName.get(k)
    if (db) {
      csiMatches.push({
        dbId: db.id,
        dbNome: db.nome,
        csiId: it.id,
        csiNome: it.name ?? "",
        clima: it.weather ?? null,
      })
    } else {
      csiNotFound.push(it.name ?? `id:${it.id}`)
    }
  }

  let savedCSI = 0
  const perItemErrors: Array<{ source: "CSI" | "PHB" | "SEP"; usina: string; id: string | number; error: string; snap?: any }> = []

  for (const m of csiMatches) {
    let kwh: number | undefined
    try {
      kwh = await getPrevDayKwhForSite(m.csiId, Y, M, D, ymd)
    } catch { }
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
        savedCSI++
        continue
      } catch (e: any) {
        perItemErrors.push({ source: "CSI", usina: m.dbNome, id: m.csiId, error: e?.message || String(e), snap })
        continue
      }
    }
    perItemErrors.push({ source: "CSI", usina: m.dbNome, id: m.csiId, error: "sem kWh", snap })
  }

  /* ========= BLOCO PHB ========= */
  const phbItems = await phbGetAllStations()
  const phbById = new Map<string, PhbStation>(phbItems.map(s => [s.powerstation_id, s]))

  const phbMatches: Array<{ dbId: number; dbNome: string; phbId: string; phbNome: string; clima?: string | null }> = []
  const phbNotFound: string[] = []
  const phbDuplicateKeys: string[] = []
  const phbSeen = new Set<string>()

  for (const it of phbItems) {
    const k = canonicalName(it.stationname ?? "")
    if (!k) continue
    if (phbSeen.has(k)) {
      phbDuplicateKeys.push(it.stationname ?? `id:${it.powerstation_id}`)
      continue
    }
    phbSeen.add(k)
    const db = byName.get(k)
    if (db) {
      const w = phbExtractWeatherInfo(it.weather)
      phbMatches.push({
        dbId: db.id,
        dbNome: db.nome,
        phbId: it.powerstation_id,
        phbNome: it.stationname,
        clima: w.cond ?? null,
      })
    } else {
      phbNotFound.push(it.stationname ?? `id:${it.powerstation_id}`)
    }
  }

  let savedPHB = 0
  for (const m of phbMatches) {
    const snap = phbById.get(m.phbId)
    const kwh = (typeof snap?.eday === "number" && Number.isFinite(snap.eday)) ? snap.eday : undefined
    let potenciaW: number | null = null
    if (typeof snap?.pac === "number" && Number.isFinite(snap.pac)) {
      potenciaW = Math.round(snap.pac)
    } else if (typeof snap?.pac === "number" && Number.isFinite(snap.pac)) {
      potenciaW = Math.round(snap.pac)
    }
    let statusRede: string | null = null;
    if (snap?.status === 1) {
      statusRede = "NORMAL";
    } else if (snap?.status === -1) {
      statusRede = "ALL_OFFLINE";
    } else {
      statusRede = "UNKNOWN";
    }

    const { cond, tempC } = phbExtractWeatherInfo(snap?.weather)
    try {
      await prisma.geracaoDiaria.upsert({
        where: { usinaId_data: { usinaId: m.dbId, data: new Date(ymd) } },
        create: {
          usinaId: m.dbId,
          data: new Date(ymd),
          energiaKwh: kwh ?? 0,
          clima: m.clima ?? cond ?? null,
          temperaturaC: Number.isFinite(tempC as any) ? tempC! : null,
          potenciaW: Number.isFinite(potenciaW as any) ? potenciaW! : null,
          rendaDia: (typeof snap?.eday_income === "number" && Number.isFinite(snap.eday_income)) ? snap.eday_income! : null,
          statusAviso: null,
          statusNegocio: null,
          statusRede,
          apiAtualizadoEm: new Date(),
          timezone: process.env.PHB_TZ ?? process.env.CSI_TZ ?? "America/Sao_Paulo",
        },
        update: {
          energiaKwh: Number.isFinite(kwh as any) ? kwh : undefined,
          clima: m.clima ?? cond ?? undefined,
          temperaturaC: Number.isFinite(tempC as any) ? tempC : undefined,
          potenciaW: Number.isFinite(potenciaW as any) ? potenciaW : undefined,
          rendaDia: (typeof snap?.eday_income === "number" && Number.isFinite(snap.eday_income)) ? snap.eday_income : undefined,
          apiAtualizadoEm: new Date(),
          timezone: process.env.PHB_TZ ?? undefined,
        },
      })
      savedPHB++
    } catch (e: any) {
      perItemErrors.push({ source: "PHB", usina: m.dbNome, id: m.phbId, error: e?.message || String(e), snap })
    }
  }

  const sepItems = await sepGetAllPlants();
  const sepById = new Map<string | number, SepPlant>(sepItems.map(p => [p.plantId, p]));

  // casamento por nome canônico
  const sepMatches: Array<{ dbId: number; dbNome: string; sepId: string | number; sepNome: string; clima?: string | null }> = [];
  const sepNotFound: string[] = [];
  const sepDuplicateKeys: string[] = [];
  const sepSeen = new Set<string>();

  for (const it of sepItems) {
    const k = canonicalName(it.plantName ?? "");
    if (!k) continue;
    if (sepSeen.has(k)) {
      sepDuplicateKeys.push(it.plantName ?? `id:${it.plantId}`);
      continue;
    }
    sepSeen.add(k);

    const db = byName.get(k);
    if (db) {
      sepMatches.push({
        dbId: db.id,
        dbNome: db.nome,
        sepId: it.plantId,
        sepNome: it.plantName,
        clima: it.weatherLabel ?? null,
      });
    } else {
      sepNotFound.push(it.plantName ?? `id:${it.plantId}`);
    }
  }

  let savedSEP = 0;

  for (const m of sepMatches) {
    const snap = sepById.get(m.sepId);

    // kWh do dia
    const kwh = (typeof snap?.dayElectric === "number" && Number.isFinite(snap.dayElectric!)) ? snap!.dayElectric! : undefined;

    // potência: realTimePower (kW) -> W
    let potenciaW: number | null = null;
    if (typeof snap?.realTimePower === "number" && Number.isFinite(snap.realTimePower!)) {
      potenciaW = Math.round(snap!.realTimePower! * 1000);
    }

    // status de rede: 1 online -> NORMAL; outros -> ALL_OFFLINE/UNKNOWN
    let statusRede: string | null = null;
    if (snap?.status === 1) statusRede = "NORMAL";
    if (snap?.status === 2) statusRede = "ALL_OFFLINE";
    else if (typeof snap?.status === "number") statusRede = "ALL_OFFLINE";
    else statusRede = "UNKNOWN";

    // clima: weatherLabel já vem em PT (ex.: “Nuvens quebradas”)
    const clima = snap?.weatherLabel ?? m.clima ?? null;

    // timestamp: usa o lastReportTime (com offset) se vier; senão Origin; senão now()
    const apiTime =
      (snap?.lastReportTime && new Date(snap.lastReportTime)) ||
      (snap?.lastReportTimeOrigin && new Date(snap.lastReportTimeOrigin)) ||
      new Date();

    try {
      await prisma.geracaoDiaria.upsert({
        where: { usinaId_data: { usinaId: m.dbId, data: new Date(ymd) } },
        create: {
          usinaId: m.dbId,
          data: new Date(ymd),
          energiaKwh: kwh ?? 0,
          clima,
          temperaturaC: null, // SEP não traz temp nessa rota
          potenciaW: Number.isFinite(potenciaW as any) ? (potenciaW as number) : null,
          rendaDia: null,      // não vem receita nessa rota
          statusAviso: "NORMAL",
          statusNegocio: "NORMAL",
          statusRede,
          apiAtualizadoEm: apiTime,
          timezone: snap?.timeZone ?? process.env.SEP_TZ ?? process.env.CSI_TZ ?? "America/Sao_Paulo",
        },
        update: {
          energiaKwh: Number.isFinite(kwh as any) ? (kwh as number) : undefined,
          clima: clima ?? undefined,
          temperaturaC: null,
          potenciaW: Number.isFinite(potenciaW as any) ? (potenciaW as number) : undefined,
          rendaDia: undefined,
          statusAviso: "NORMAL",
          statusNegocio: "NORMAL",
          statusRede,
          apiAtualizadoEm: apiTime,
          timezone: snap?.timeZone ?? undefined,
        },
      });
      savedSEP++;
    } catch (e: any) {
      perItemErrors.push({
        source: "SEP",
        usina: m.dbNome,
        id: String(m.sepId),
        error: e?.message || String(e),
        snap,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    date: ymd,
    db_total: dbUsinas.length,
    // CSI
    csi_total: csiItems.length,
    csi_matched: csiMatches.length,
    csi_saved: savedCSI,
    csi_notFound: csiNotFound,
    csi_duplicateKeys: csiDuplicateKeys,
    // PHB
    phb_total: phbItems.length,
    phb_matched: phbMatches.length,
    phb_saved: savedPHB,
    phb_notFound: phbNotFound,
    phb_duplicateKeys: phbDuplicateKeys,
    // SEP
    sep_total: sepItems.length,
    sep_matched: sepMatches.length,
    sep_saved: savedSEP,
    sep_notFound: sepNotFound,
    sep_duplicateKeys: sepDuplicateKeys,
    // logs
    perItemErrors,
  })
}
