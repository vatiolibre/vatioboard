import type { VatioAppId, VatioAppLogger } from "./types";

type ConsoleMethod = "debug" | "info" | "warn" | "error";

function writeLog(method: ConsoleMethod, appId: VatioAppId, message: string, details: unknown[]) {
  const prefix = `[vatioboard:app:${appId}]`;
  const targetConsole = globalThis["console"];
  const writer = targetConsole?.[method] || targetConsole?.log;
  writer?.call(targetConsole, prefix, message, ...details);
}

export function createAppLogger(appId: VatioAppId): VatioAppLogger {
  return {
    debug(message, ...details) {
      writeLog("debug", appId, message, details);
    },
    info(message, ...details) {
      writeLog("info", appId, message, details);
    },
    warn(message, ...details) {
      writeLog("warn", appId, message, details);
    },
    error(message, ...details) {
      writeLog("error", appId, message, details);
    },
  };
}
