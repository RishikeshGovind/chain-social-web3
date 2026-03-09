type LogLevel = "debug" | "info" | "warn" | "error";

type LogMeta = Record<string, unknown> | undefined;

function isDebugEnabled() {
  const raw = process.env.CHAINSOCIAL_DEBUG?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return process.env.NODE_ENV !== "production";
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    };
  }
  return error;
}

function normalizeMeta(meta: LogMeta) {
  if (!meta) return undefined;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    normalized[key] = key.toLowerCase().includes("error") ? serializeError(value) : value;
  }
  return normalized;
}

function write(level: LogLevel, event: string, meta?: LogMeta) {
  if (level === "debug" && !isDebugEnabled()) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...normalizeMeta(meta),
  };
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug(event: string, meta?: LogMeta) {
    write("debug", event, meta);
  },
  info(event: string, meta?: LogMeta) {
    write("info", event, meta);
  },
  warn(event: string, meta?: LogMeta) {
    write("warn", event, meta);
  },
  error(event: string, meta?: LogMeta) {
    write("error", event, meta);
  },
};
