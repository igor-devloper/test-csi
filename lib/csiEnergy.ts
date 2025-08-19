import axios from "axios";

export async function getPrevDayKwhForSite(siteId: number, dateYMD: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "";
  const url = `${base}/api/csi/day?site=${siteId}&date=${dateYMD}`;

  const res = await axios.get<{ kwh: number }>(url, {
    headers: { Accept: "application/json" },
    timeout: 30_000,
    validateStatus: s => s >= 200 && s < 500,
  });

  if (!res.data || typeof res.data.kwh !== "number")
    throw new Error(`sem kWh (site ${siteId})`);

  return res.data.kwh;
}
