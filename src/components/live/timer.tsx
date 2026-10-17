"use client";
/** Cronômetro exibido a partir do estado oficial do servidor (o cliente só representa o tempo). */
import { useEffect, useState } from "react";
import { Timer as TimerIcon, Pause } from "lucide-react";
import type { TimerDTO } from "@shared/types";
import { cn } from "@/lib/utils";

export function computeRemaining(timer: TimerDTO, receivedAt: number, offsetMs: number) {
  if (timer.limitMs === null) return null;
  const nowServer = Date.now() + offsetMs;
  const elapsed = timer.running ? timer.elapsedMs + Math.max(0, nowServer - timer.serverNow) : timer.elapsedMs;
  void receivedAt;
  return Math.max(0, timer.limitMs - elapsed);
}

export function useRemaining(timer: TimerDTO | null | undefined) {
  const [, force] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (timer) setOffset(timer.serverNow - Date.now());
  }, [timer]);
  useEffect(() => {
    if (!timer?.running) return;
    const id = setInterval(() => force((x) => x + 1), 200);
    return () => clearInterval(id);
  }, [timer]);
  if (!timer) return null;
  return computeRemaining(timer, Date.now(), offset);
}

export function Countdown({ timer, size = "md", className }: { timer: TimerDTO | null | undefined; size?: "md" | "lg" | "xl"; className?: string }) {
  const remaining = useRemaining(timer);
  if (!timer || remaining === null) return null;
  const sec = Math.ceil(remaining / 1000);
  const pct = timer.limitMs ? (remaining / timer.limitMs) * 100 : 0;
  const urgent = sec <= 5 && timer.running;
  const sizes = { md: "text-xl", lg: "text-4xl", xl: "text-7xl" };
  const ring = { md: 44, lg: 96, xl: 180 }[size];
  const stroke = { md: 4, lg: 7, xl: 12 }[size];
  const r = (ring - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} role="timer" aria-live="off" aria-label={`${sec} segundos restantes`}>
      <svg width={ring} height={ring} className="-rotate-90">
        <circle cx={ring / 2} cy={ring / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={stroke} />
        <circle
          cx={ring / 2}
          cy={ring / 2}
          r={r}
          fill="none"
          stroke={urgent ? "var(--negative)" : "var(--brand)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 200ms linear" }}
        />
      </svg>
      <span className={cn("absolute font-black tabular", sizes[size], urgent && "text-negative")}>{sec}</span>
      {!timer.running && remaining > 0 && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-warning p-0.5 text-navy-950">
          <Pause className="size-3" />
        </span>
      )}
    </div>
  );
}

export function TimerChip({ timer }: { timer: TimerDTO | null | undefined }) {
  const remaining = useRemaining(timer);
  if (!timer || remaining === null) return null;
  const sec = Math.ceil(remaining / 1000);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-black tabular", sec <= 5 ? "bg-negative/20 text-negative" : "bg-brand/15 text-brand")}>
      <TimerIcon className="size-4" />
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
      {!timer.running && sec > 0 && <Pause className="size-3" />}
    </span>
  );
}
