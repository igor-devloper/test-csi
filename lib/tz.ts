const TZ = process.env.CSI_TZ || "America/Sao_Paulo";

function pad(n: number){ return String(n).padStart(2,"0"); }

export function ymdInTZ(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" });
  const [y, m, d] = f.format(date).split("-").map(Number);
  return { y, m, d };
}

export function yesterdayInTZ() {
  const now = new Date();
  // “Ontem” no fuso: subtrai 24h e recalcula em TZ
  const prev = new Date(now.getTime() - 24*60*60*1000);
  return ymdInTZ(prev);
}

export function fmtYMD(y:number,m:number,d:number){ return `${y}-${pad(m)}-${pad(d)}`; }
