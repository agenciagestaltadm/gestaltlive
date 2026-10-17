"use client";
import { createContext, useContext } from "react";
import type { EventDetail } from "./event-types";

export interface EventDataCtx {
  event: EventDetail;
  reload: () => Promise<unknown>;
}

const Ctx = createContext<EventDataCtx | null>(null);

/** Provedor dos dados do evento carregado em /admin/eventos/[id] (layout). */
export function EventDataProvider({ value, children }: { value: EventDataCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Evento atual e função de recarga — disponível nas páginas filhas de /admin/eventos/[id]. */
export function useEventData(): EventDataCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEventData fora de /admin/eventos/[id]");
  return c;
}

export type { EventDetail } from "./event-types";
