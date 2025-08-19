// app/api/csi/systems/route.ts
import { NextResponse } from "next/server";
import { getAllSystems } from "@/lib/csiSites";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const items = await getAllSystems(); // usa CSI_BEARER do .env
    return NextResponse.json({ total: items.length, items }, { status: 200 });
  } catch (e: any) {
    const status = e?.response?.status ?? 500;
    const detail = e?.response?.data ?? e?.message ?? String(e);
    return NextResponse.json(
      { error: "upstream_failed", status, detail },
      { status: 500 }
    );
  }
}
