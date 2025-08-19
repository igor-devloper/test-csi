export function ymdTZ(d = new Date(), tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // YYYY-MM-DD
}
export function yesterdayYMD(tz = process.env.CSI_TZ || "America/Sao_Paulo") {
  const base = ymdTZ(new Date(), tz);
  const ms = Date.parse(base + "T12:00:00");
  return ymdTZ(new Date(ms - 24 * 3600 * 1000), tz);
}
