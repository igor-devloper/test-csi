import { NextResponse } from "next/server";
import { getMonthStatsAll, pickDayKwh } from "@/lib/csiClient";
import { yesterdayInTZ, fmtYMD } from "@/lib/tz";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { y, m, d } = yesterdayInTZ();
    const items = await getMonthStatsAll(y, m); // region/tagId opcionais
    const kwh = pickDayKwh(items, d);
    return NextResponse.json({ date: fmtYMD(y,m,d), kwh }, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
