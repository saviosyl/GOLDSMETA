type LogLevel = "debug" | "info" | "warn" | "error";

const redact = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/secret|token|authorization|apiKey/i.test(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, redact(entry)];
    })
  );
};

const writeLog = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context: context ? redact(context) : undefined
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
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => writeLog("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => writeLog("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => writeLog("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => writeLog("error", message, context)
};
