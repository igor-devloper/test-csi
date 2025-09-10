// app/api/cron/sync-history/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalName } from "@/lib/name";

/* ====== CSI ====== */
import { CSI_BASE, portalHeaders, CSI_TZ } from "@/lib/csiClient";
import { getAllSystems as csiGetAllSystems, type SiteRow } from "@/lib/csiSites";

/* ====== PHB ====== */
import { phbGetAllStations, type PhbStation } from "@/lib/phbSites";
import { phbGetMonthHistory, PHB_CHARTS_BASE } from "@/lib/phbHistory";
import { PHB_TZ } from "@/lib/phbClient";

/* ====== SEP ====== */
import { sepGetAllPlants, type SepPlant } from "@/lib/sepPlants";
import { sepGetMonthHistory, monthsSinceApril as sepMonthsSinceApril, SEP_TZ } from "@/lib/sepHistory";

/* ====== Config ====== */
const HIST_MONTHS_BACK = Number(process.env.HIST_MONTHS_BACK ?? 2); // usado pelo CSI/PHB
const HIST_EPSILON = Number(process.env.HIST_EPSILON ?? 0.05);

/** Y-M-D em TZ alvo */
function todayYMDInTZ(tz = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Mês atual + N anteriores (para CSI/PHB) */
function monthsWindow(nBack: number, base = new Date()) {
  const out: Array<{ y: number; m: number }> = [];
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  for (let i = 0; i <= nBack; i++) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    out.push({ y, m });
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

/* ===================== CSI: histórico mensal ===================== */
async function csiGetMonth(siteId: number, year: number, month: number) {
  const rel = `/maintain-s/history/power/${siteId}/stats/month?year=${year}&month=${month}`;
  const url = `${CSI_BASE}${rel}`;
  const headers = portalHeaders();
  const res = await fetch(url, { headers, next: { revalidate: 0 } });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({} as any));
  const list: Array<{ acceptDay?: string; generationValue?: number }> =
    json?.data?.records ?? json?.records ?? [];
  return list
    .map((r) => ({
      date: (r.acceptDay || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
      kwh: typeof r.generationValue === "number" ? r.generationValue : NaN,
    }))
    .filter((r) => r.date && Number.isFinite(r.kwh));
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const expected = process.env.CRON_SECRET || process.env.CRON_KEY;
  if (expected && key !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nowYMD = todayYMDInTZ(CSI_TZ);
  const monthsCSI_PHB = monthsWindow(HIST_MONTHS_BACK);
  const monthsSEP = sepMonthsSinceApril(); // abril..mês atual (pode cruzar ano)

  // DB usinas
  const dbUsinas = await prisma.usina.findMany({ select: { id: true, nome: true } });
  const byName = new Map(dbUsinas.map((u) => [canonicalName(u.nome), u]));

  const diffs: Array<{ source: "CSI" | "PHB" | "SEP"; usina: string; date: string; from: number | null; to: number }> = [];
  const errors: Array<{ source: "CSI" | "PHB" | "SEP"; usina: string; id: string | number; error: string }> = [];

  /* ==================== CSI ==================== */
  type SiteExt = SiteRow & { name?: string };
  const csiItems = (await csiGetAllSystems()) as SiteExt[];
  const csiMatches: Array<{ dbId: number; dbNome: string; csiId: number; csiNome: string }> = [];
  {
    const seen = new Set<string>();
    for (const it of csiItems) {
      const k = canonicalName(it.name ?? "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const db = byName.get(k);
      if (db) csiMatches.push({ dbId: db.id, dbNome: db.nome, csiId: it.id, csiNome: it.name ?? String(it.id) });
    }
  }

  let csiUpdated = 0;
  for (const m of csiMatches) {
    try {
      for (const mm of monthsCSI_PHB) {
        const hist = await csiGetMonth(m.csiId, mm.y, mm.m);
        if (!hist.length) continue;

        const start = new Date(Date.UTC(mm.y, mm.m - 1, 1));
        const end = new Date(Date.UTC(mm.m === 12 ? mm.y + 1 : mm.y, mm.m === 12 ? 0 : mm.m, 1));
        const existingRows = await prisma.geracaoDiaria.findMany({
          where: { usinaId: m.dbId, data: { gte: start, lt: end } },
          select: { data: true, energiaKwh: true },
        });
        const existing = new Map(existingRows.map((r) => [r.data.toISOString().slice(0, 10), r.energiaKwh as any]));

        for (const item of hist) {
          const { date, kwh } = item;
          const curr = (existing.has(date) ? existing.get(date) : null) as number | null;
          const differs = curr == null ? true : Math.abs(Number(curr) - Number(kwh)) > HIST_EPSILON;

          if (!existing.has(date) || differs) {
            await prisma.geracaoDiaria.upsert({
              where: { usinaId_data: { usinaId: m.dbId, data: new Date(date) } },
              create: { usinaId: m.dbId, data: new Date(date), energiaKwh: kwh, apiAtualizadoEm: new Date(), timezone: CSI_TZ },
              update: { energiaKwh: kwh, apiAtualizadoEm: new Date() },
            });
            csiUpdated++;
            diffs.push({ source: "CSI", usina: m.dbNome, date, from: curr, to: kwh });
          }
        }
      }
    } catch (e: any) {
      errors.push({ source: "CSI", usina: m.dbNome, id: m.csiId, error: e?.message || String(e) });
    }
  }

  /* ==================== PHB ==================== */
  const phbItems = await phbGetAllStations();
  const phbMatches: Array<{ dbId: number; dbNome: string; phbId: string; phbNome: string }> = [];
  {
    const seen = new Set<string>();
    for (const it of phbItems) {
      const k = canonicalName(it.stationname ?? "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const db = byName.get(k);
      if (db) phbMatches.push({ dbId: db.id, dbNome: db.nome, phbId: it.powerstation_id, phbNome: it.stationname });
    }
  }

  let phbUpdated = 0;
  for (const m of phbMatches) {
    try {
      for (const mm of monthsCSI_PHB) {
        const hist = await phbGetMonthHistory(m.phbId, mm.y, mm.m);
        if (!hist.length) continue;

        const start = new Date(Date.UTC(mm.y, mm.m - 1, 1));
        const end = new Date(Date.UTC(mm.m === 12 ? mm.y + 1 : mm.y, mm.m === 12 ? 0 : mm.m, 1));
        const existingRows = await prisma.geracaoDiaria.findMany({
          where: { usinaId: m.dbId, data: { gte: start, lt: end } },
          select: { data: true, energiaKwh: true },
        });
        const existing = new Map(existingRows.map((r) => [r.data.toISOString().slice(0, 10), r.energiaKwh as any]));

        for (const item of hist) {
          const { date, kwh } = item;
          const curr = (existing.has(date) ? existing.get(date) : null) as number | null;
          const differs = curr == null ? true : Math.abs(Number(curr) - Number(kwh)) > HIST_EPSILON;

          if (!existing.has(date) || differs) {
            await prisma.geracaoDiaria.upsert({
              where: { usinaId_data: { usinaId: m.dbId, data: new Date(date) } },
              create: { usinaId: m.dbId, data: new Date(date), energiaKwh: kwh, apiAtualizadoEm: new Date(), timezone: PHB_TZ },
              update: { energiaKwh: kwh, apiAtualizadoEm: new Date() },
            });
            phbUpdated++;
            diffs.push({ source: "PHB", usina: m.dbNome, date, from: curr, to: kwh });
          }
        }
      }
    } catch (e: any) {
      errors.push({ source: "PHB", usina: m.dbNome, id: m.phbId, error: e?.message || String(e) });
    }
  }

  /* ==================== SEP (histograma diário) ==================== */
  const sepItems = await sepGetAllPlants(); // já temos plantId / plantName
  const sepMatches: Array<{ dbId: number; dbNome: string; sepId: string | number; sepNome: string }> = [];
  {
    const seen = new Set<string>();
    for (const it of sepItems) {
      const k = canonicalName(it.plantName ?? "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const db = byName.get(k);
      if (db) sepMatches.push({ dbId: db.id, dbNome: db.nome, sepId: it.plantId, sepNome: it.plantName });
    }
  }

  let sepUpdated = 0;
  for (const m of sepMatches) {
    try {
      for (const mm of monthsSEP) {
        const hist = await sepGetMonthHistory(m.sepId, mm.y, mm.m); // [{date,kwh}]
        if (!hist.length) continue;

        const start = new Date(Date.UTC(mm.y, mm.m - 1, 1));
        const end = new Date(Date.UTC(mm.m === 12 ? mm.y + 1 : mm.y, mm.m === 12 ? 0 : mm.m, 1));
        const existingRows = await prisma.geracaoDiaria.findMany({
          where: { usinaId: m.dbId, data: { gte: start, lt: end } },
          select: { data: true, energiaKwh: true },
        });
        const existing = new Map(existingRows.map((r) => [r.data.toISOString().slice(0, 10), r.energiaKwh as any]));

        for (const item of hist) {
          const { date, kwh } = item;
          const curr = (existing.has(date) ? existing.get(date) : null) as number | null;
          const differs = curr == null ? true : Math.abs(Number(curr) - Number(kwh)) > HIST_EPSILON;

          if (!existing.has(date) || differs) {
            await prisma.geracaoDiaria.upsert({
              where: { usinaId_data: { usinaId: m.dbId, data: new Date(date) } },
              create: { usinaId: m.dbId, data: new Date(date), energiaKwh: kwh, apiAtualizadoEm: new Date(), timezone: SEP_TZ },
              update: { energiaKwh: kwh, apiAtualizadoEm: new Date() },
            });
            sepUpdated++;
            diffs.push({ source: "SEP", usina: m.dbNome, date, from: curr, to: kwh });
          }
        }
      }
    } catch (e: any) {
      errors.push({ source: "SEP", usina: m.dbNome, id: m.sepId, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    now: nowYMD,
    epsilon: HIST_EPSILON,
    // janelas usadas
    months_csi_phb: monthsCSI_PHB,
    months_sep: monthsSEP,
    // contagens
    csi_total: csiItems.length,
    csi_matched: csiMatches.length,
    csi_updated: csiUpdated,
    phb_total: phbItems.length,
    phb_matched: phbMatches.length,
    phb_updated: phbUpdated,
    sep_total: sepItems.length,
    sep_matched: sepMatches.length,
    sep_updated: sepUpdated,
    // refs úteis
    refs: {
      csi_base: CSI_BASE,
      phb_charts_base: PHB_CHARTS_BASE,
      sep_base: process.env.SEP_BASE,
    },
    diffs,
    errors,
  });
}
