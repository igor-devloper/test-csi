// app/page.tsx
import { headers } from "next/headers";
import SystemsTable, { type System } from "@/components/systems-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getOrigin() {
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (env) return env.replace(/\/+$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function fetchSystems(): Promise<System[]> {
  const origin = await getOrigin();
  const res = await fetch(`${origin}/api/csi/systems`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Falha ao buscar systems: ${res.status}`);
  const json = (await res.json()) as { total: number; items: System[] };
  return json.items ?? [];
}

export default async function Page() {
  const items = await fetchSystems();
  return (
    <main className="container mx-auto p-4">
      <SystemsTable items={items} />
    </main>
  );
}
