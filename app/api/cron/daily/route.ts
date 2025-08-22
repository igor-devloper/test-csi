// app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalName } from "@/lib/name";
import { getPrevDayKwhForSite } from "@/lib/csiEnergy"; // ainda usamos, mas com fallback
import { getAllSystems, type SiteRow } from "@/lib/csiSites";

type DbUsinaMinimal = { id: number; nome: string };
type Match = {
  dbId: number;
  dbNome: string;
  csiId: number;
  csiNome: string;
  clima?: string | null;
};

export const dynamic = "force-dynamic";

function todayYMDInTZ(tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pickCSIInfo(it?: SiteRow) {
  if (!it) return undefined;
  return {
    id: it.id,
    name: it.name,
    locationAddress: it.locationAddress,
    weather: it.weather,
    temperature: it.temperature,
    networkStatus: it.networkStatus,
    generationPower: it.generationPower,     // W (instantâneo)
    generationValue: it.generationValue,     // kWh acumulado de HOJE
    installedCapacity: it.installedCapacity, // kWp
    lastUpdateTime: it.lastUpdateTime,       // epoch (s)
  };
}

export async function GET(req: Request) {
  // (opcional) proteção por chave
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const expected = process.env.CRON_SECRET;
  if (expected && key !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Data de HOJE (não ontem)
  const ymd = todayYMDInTZ();
  const [Y, M, D] = ymd.split("-").map(Number);

  // 1) usinas do seu banco (somente as que existem serão salvas)
  const dbUsinas: DbUsinaMinimal[] = await prisma.usinas.findMany({
    select: { id: true, nome: true },
  });
  const byName = new Map(dbUsinas.map(u => [canonicalName(u.nome), u]));

  // 2) usinas do portal
  const csiItems: SiteRow[] = await getAllSystems();
  const csiById = new Map<number, SiteRow>(csiItems.map(i => [i.id, i]));

  // 3) casar por nome EXATO
  const matches: Match[] = [];
  const notFound: string[] = [];
  const duplicateKeys: string[] = [];
  const seen = new Set<string>();

  for (const it of csiItems) {
    const k = canonicalName(it.name ?? "");
    if (!k) continue;
    if (seen.has(k)) { duplicateKeys.push(it.name ?? `id:${it.id}`); continue; }
    seen.add(k);

    const db = byName.get(k);
    if (db) {
      matches.push({
        dbId: db.id,
        dbNome: db.nome,
        csiId: it.id,
        csiNome: it.name ?? "",
        clima: it.weather ?? null,
      });
    } else {
      notFound.push(it.name ?? `id:${it.id}`);
    }
  }

  // 4) tentar kWh via /api/csi/day; se falhar, usar generationValue da lista
  let saved = 0;
  const perItemErrors: Array<{
    usina: string;
    csiId: number;
    error: string;
    csi?: ReturnType<typeof pickCSIInfo>;
  }> = [];

  for (const m of matches) {
    let kwh: number | undefined;

    try {
      // tenta pela rota interna (se ela retornar {kwh})
      kwh = await getPrevDayKwhForSite(m.csiId, Y, M, D, ymd);
    } catch (e) {
      // silencioso: vamos tentar o fallback abaixo
    }

    if (!Number.isFinite(kwh)) {
      const snap = csiById.get(m.csiId);
      const alt = snap?.generationValue;
      if (typeof alt === "number" && Number.isFinite(alt)) {
        kwh = alt;
      }
    }

    if (Number.isFinite(kwh)) {
      try {
        await prisma.geracoes_diarias.upsert({
          where: { usina_id_data: { usina_id: m.dbId, data: new Date(ymd) } },
          create: { usina_id: m.dbId, data: new Date(ymd), energia_kwh: kwh!, clima: m.clima ?? null, atualizado_em: new Date() },
          update: { energia_kwh: kwh!, clima: m.clima ?? null, atualizado_em: new Date() },
        });
        saved++;
        continue;
      } catch (e: any) {
        perItemErrors.push({
          usina: m.dbNome,
          csiId: m.csiId,
          error: e?.message || String(e),
          csi: pickCSIInfo(csiById.get(m.csiId)),
        });
        continue;
      }
    }

    // se nem rota nem fallback deram certo, reporta erro
    perItemErrors.push({
      usina: m.dbNome,
      csiId: m.csiId,
      error: `sem kWh (site ${m.csiId})`,
      csi: pickCSIInfo(csiById.get(m.csiId)),
    });
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
  });
}
