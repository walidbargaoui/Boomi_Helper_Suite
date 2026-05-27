type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.BOOMI_HELPER_LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel) {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>, error?: unknown) => {
    if (!shouldLog("debug")) return;
    const payload = { level: "debug", ts: new Date().toISOString(), msg, ...data };
    const errPayload = serializeError(error);
    console.log(JSON.stringify(errPayload ? { ...payload, ...errPayload } : payload));
  },
  info: (msg: string, data?: Record<string, unknown>, error?: unknown) => {
    if (!shouldLog("info")) return;
    const payload = { level: "info", ts: new Date().toISOString(), msg, ...data };
    const errPayload = serializeError(error);
    console.log(JSON.stringify(errPayload ? { ...payload, ...errPayload } : payload));
  },
  warn: (msg: string, data?: Record<string, unknown>, error?: unknown) => {
    if (!shouldLog("warn")) return;
    const payload = { level: "warn", ts: new Date().toISOString(), msg, ...data };
    const errPayload = serializeError(error);
    console.warn(JSON.stringify(errPayload ? { ...payload, ...errPayload } : payload));
  },
  error: (msg: string, data?: Record<string, unknown>, error?: unknown) => {
    if (!shouldLog("error")) return;
    const payload = { level: "error", ts: new Date().toISOString(), msg, ...data };
    const errPayload = serializeError(error);
    console.error(JSON.stringify(errPayload ? { ...payload, ...errPayload } : payload));
  },
};
