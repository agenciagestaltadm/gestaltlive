/** Logger estruturado (JSON por linha) — compatível com coletores como Loki, Datadog e CloudWatch. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, };

function threshold(): number {
  const l = (process.env.LOG_LEVEL as Level) || "info";
  return ORDER[l] ?? 20;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line: Record<string, unknown> = { t: new Date().toISOString(), level, msg, ...fields };
  if (fields?.err instanceof Error) {
    line.err = { message: fields.err.message, stack: fields.err.stack };
  }
  const out = JSON.stringify(line);
  if (level === "error" || level === "warn") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
