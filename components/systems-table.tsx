"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Cloud, CloudLightning, CloudRain, CloudSun, CircleHelp, Sun,
} from "lucide-react";

export type System = {
  id: number;
  name: string;
  ownerName?: string | null;
  locationAddress?: string;
  installedCapacity?: number | null;   // kWp
  generationPower?: number | null;     // W (tempo real)
  generationValue?: number | null;     // kWh hoje
  weather?: string | null;
  temperature?: number | null;         // °C
  networkStatus?: "NORMAL" | "PARTIAL_OFFLINE" | "ALL_OFFLINE" | "OFFLINE" | string | null;
  warningStatus?: "NORMAL" | "WARNING" | string | null;
  lastUpdateTime?: number | null;      // epoch seconds
};

function formatKW(w?: number | null) {
  if (w == null) return "-";
  const kw = w / 1000;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(kw) + " kW";
}
function formatKWh(kwh?: number | null) {
  if (kwh == null) return "-";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(kwh) + " kWh";
}
function formatKwp(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v) + " kWp";
}
function relTimeFromSeconds(s?: number | null) {
  if (!s) return "-";
  const ms = s * 1000;
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.trunc(diffSec), "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffSec / 3600);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffSec / 86400);
  return rtf.format(diffDay, "day");
}

const WEATHER_ICON: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  sunny: { Icon: Sun, label: "Ensolarado" },
  cloudy: { Icon: Cloud, label: "Nublado" },
  overcast: { Icon: Cloud, label: "Encoberto" },
  rain: { Icon: CloudRain, label: "Chuva" },
  rainy: { Icon: CloudRain, label: "Chuva" },
  thunder: { Icon: CloudLightning, label: "Tempestade" },
  storm: { Icon: CloudLightning, label: "Tempestade" },
  "partly-cloudy": { Icon: CloudSun, label: "Parcialmente nublado" },
};

function WeatherCell({ weather, temperature }: { weather?: string | null; temperature?: number | null }) {
  const key = (weather || "").toLowerCase();
  const match =
    WEATHER_ICON[key] ||
    (key.includes("sun") ? WEATHER_ICON.sunny
      : key.includes("rain") ? WEATHER_ICON.rain
      : key.includes("cloud") ? WEATHER_ICON.cloudy
      : undefined);

  const Icon = match?.Icon ?? CircleHelp;
  const label = match?.label ?? (weather || "—");
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4" />
      <span className="text-sm text-muted-foreground">
        {label}{temperature != null ? ` · ${Math.round(temperature)}°C` : ""}
      </span>
    </div>
  );
}

function StatusBadges({ network, warning }: { network?: System["networkStatus"]; warning?: System["warningStatus"] }) {
  const color =
    network === "NORMAL" ? "bg-emerald-500"
      : network === "PARTIAL_OFFLINE" ? "bg-amber-500"
      : network === "ALL_OFFLINE" || network === "OFFLINE" ? "bg-red-500"
      : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <Badge className={cn("text-white", color)}>{network ?? "-"}</Badge>
      {warning && warning !== "NORMAL" ? <Badge variant="destructive">ALERTA</Badge> : null}
    </div>
  );
}

export default function SystemsTable({ items }: { items: System[] }) {
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    if (!q.trim()) return items;
    const s = q.toLowerCase();
    return items.filter(
      (i) =>
        i.name?.toLowerCase().includes(s) ||
        i.ownerName?.toLowerCase().includes(s) ||
        i.locationAddress?.toLowerCase().includes(s)
    );
  }, [q, items]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Usinas</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} de {items.length} listadas
          </p>
        </div>
        <div className="sm:w-80">
          <Input placeholder="Buscar por nome, endereço ou cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <ScrollArea className="w-full">
        <Table>
          <TableCaption className="sr-only">Lista de usinas</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Usina</TableHead>
              <TableHead>Clima</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Potência agora</TableHead>
              <TableHead className="text-right">Geração hoje</TableHead>
              <TableHead className="text-right">Capacidade</TableHead>
              <TableHead>Última atualização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id} className="hover:bg-muted/40">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.ownerName ? `${s.ownerName} · ` : ""}{s.locationAddress || "—"}
                    </span>
                  </div>
                </TableCell>
                <TableCell><WeatherCell weather={s.weather} temperature={s.temperature} /></TableCell>
                <TableCell><StatusBadges network={s.networkStatus} warning={s.warningStatus} /></TableCell>
                <TableCell className="text-right">{formatKW(s.generationPower)}</TableCell>
                <TableCell className="text-right">{formatKWh(s.generationValue)}</TableCell>
                <TableCell className="text-right">{formatKwp(s.installedCapacity)}</TableCell>
                <TableCell className="text-muted-foreground">{relTimeFromSeconds(s.lastUpdateTime)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </Card>
  );
}
