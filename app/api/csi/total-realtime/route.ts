import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { getAllSystems } from "@/lib/csiSites";
import { getDayRecord, lastPowerKW } from "@/lib/csiClient";
import { ymdInTZ } from "@/lib/tz";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const systems = await getAllSystems();            // id + meta (útil p/ debug)
    const ids = systems.map(s => s.id);
    if (!ids.length) return NextResponse.json({ totalKW: 0, systems: [] }, { status: 200 });

    const { y, m, d } = ymdInTZ();
    const limit = pLimit(6);                          // controla concorrência

    const results = await Promise.all(ids.map(id => limit(async () => {
      const resp = await getDayRecord(id, y, m, d);
      const kw = lastPowerKW(resp) ?? 0;
      return { id, name: systems.find(s => s.id === id)?.name, kw };
    })));

    const totalKW = results.reduce((s, r) => s + r.kw, 0);
    return NextResponse.json({ totalKW, systems: results }, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
