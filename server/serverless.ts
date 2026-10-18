/**
 * Runtime para funções serverless (Vercel): uma instância por processo da função, reaproveitada entre
 * requisições. Sem migrações na inicialização (rodam no build: npm run vercel-build), sem Socket.IO e
 * sem agendador — o tempo real usa o Supabase Realtime e os temporizadores rodam pelo tick da sessão.
 */
import { createRuntime, type Runtime } from "./core";

let runtime: Promise<Runtime> | null = null;

export function getServerlessRuntime(): Promise<Runtime> {
  if (!runtime) {
    const url = process.env.DATABASE_URL ?? "";
    if (!/^postgres(ql)?:\/\//.test(url)) {
      return Promise.reject(new Error("DATABASE_URL precisa apontar para o PostgreSQL (Supabase) nas funções da Vercel."));
    }
    runtime = createRuntime({ databaseUrl: url, migrate: false }).catch((err) => {
      runtime = null;
      throw err;
    });
  }
  return runtime;
}
