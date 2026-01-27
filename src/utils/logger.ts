/**
 * 日志工具
 */

import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

let globalLogger: PinoLogger | null = null;

/** 创建日志器 */
export function createLogger(options: {
  level?: LogLevel;
  name?: string;
  pretty?: boolean;
}): PinoLogger {
  const { level = "info", name = "mozi", pretty = process.env.NODE_ENV !== "production" } = options;

  const logger = pino({
    name,
    level,
    transport: pretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  });

  return logger;
}

/** 获取全局日志器 */
export function getLogger(): PinoLogger {
  if (!globalLogger) {
    globalLogger = createLogger({
      level: (process.env.LOG_LEVEL as LogLevel) || "info",
      pretty: process.env.NODE_ENV !== "production",
    });
  }
  return globalLogger;
}

/** 设置全局日志器 */
export function setLogger(logger: PinoLogger): void {
  globalLogger = logger;
}

/** 创建子日志器 */
export function getChildLogger(name: string): PinoLogger {
  return getLogger().child({ module: name });
}

export { type PinoLogger as Logger };
