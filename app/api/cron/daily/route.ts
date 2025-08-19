// app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
const { prisma } = await import("@/lib/prisma");
import { canonicalName } from "@/lib/name";
import { yesterdayYMD } from "@/lib/date";
import { getPrevDayKwhForSite } from "@/lib/csiEnergy";
import { getAllSystems, type SiteRow } from "@/lib/csiSites";

// Tipos auxiliares
type DbUsinaMinimal = { id: number; nome: string };
type Match = { dbId: number; dbNome: string; csiId: number; csiNome: string; clima?: string };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- auth por chave simples (env: CRON_KEY) ---
function isAuthorized(req: Request) {
  const cfgKey = process.env.CRON_KEY || "";
  if (!cfgKey) return false;
  const url = new URL(req.url);
  const byQuery = url.searchParams.get("key");
  const byHeader = req.headers.get("x-cron-key");
  return byQuery === cfgKey || byHeader === cfgKey;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ymd = yesterdayYMD(); // "YYYY-MM-DD" (timezone já tratado no seu helper)

  // 1) usinas do seu banco
  const dbUsinas: DbUsinaMinimal[] = await prisma.usinas.findMany({
    select: { id: true, nome: true },
  });

  const byName = new Map<string, DbUsinaMinimal>(
    dbUsinas.map((u) => [canonicalName(u.nome ?? ""), u]),
  );

  // 2) usinas do portal
  const csiItems: SiteRow[] = await getAllSystems();

  const matches: Match[] = [];
  const notFound: string[] = [];
  const duplicateKeys: string[] = [];

  // pequeno guard para nomes duplicados no CSI
  const seen = new Set<string>();

  for (const it of csiItems) {
    const norm = canonicalName(it.name ?? "");
    if (!norm) continue;

    // marca duplicados de origem (apenas informativo)
    if (seen.has(norm)) duplicateKeys.push(it.name ?? `id:${it.id}`);
    else seen.add(norm);

    const db = byName.get(norm);
    if (db) {
      matches.push({
        dbId: db.id,
        dbNome: db.nome,
        csiId: it.id,
        csiNome: it.name ?? "",
        clima: it.weather,
      });
    } else {
      notFound.push(it.name ?? `id:${it.id}`);
    }
  }

  // 3) coleta kWh de ontem e UPSERT — sequencial para evitar 429
  let saved = 0;
  const perItemErrors: Array<{ usina: string; csiId: number; error: string }> = [];

  for (const m of matches) {
    try {
      const kwh = await getPrevDayKwhForSite(m.csiId, ymd); // number
      await prisma.geracoes_diarias.upsert({
        where: { usina_id_data: { usina_id: m.dbId, data: new Date(ymd) } },
        create: {
          usina_id: m.dbId,
          data: new Date(ymd),
          energia_kwh: kwh,
          clima: m.clima ?? null,
          atualizado_em: new Date()
        },
        update: {
          energia_kwh: kwh,
          clima: m.clima ?? null,
        },
      });
      saved++;
    } catch (e: any) {
      // não interrompe o cron; apenas acumula
      perItemErrors.push({
        usina: m.dbNome,
        csiId: m.csiId,
        error: String(e?.message ?? e),
      });
      console.error(`falha ${m.dbNome} (${m.csiId}):`, e?.message || e);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      date: ymd,
      db_total: dbUsinas.length,
      csi_total: csiItems.length,
      matched: matches.length,
      saved,
      notFound,       // nomes do CSI que não batem com o banco
      duplicateKeys,  // nomes duplicados no CSI (normalizados)
      perItemErrors,  // falhas de coleta/gravação por usina
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
