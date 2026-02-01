/**
 * 定时任务调度计算
 *
 * 参考 moltbot 的 schedule.ts 实现
 * 支持三种调度模式的下次运行时间计算
 */

import type { CronSchedule, CronJob } from "./types.js";

/**
 * 简单的 Cron 表达式解析器
 *
 * 支持标准 5 字段格式: 分 时 日 月 周
 * 支持 6 字段格式: 秒 分 时 日 月 周
 * 支持: 数字, *, 逗号, 连字符, 斜杠
 */
function parseCronField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    // 斜杠: */2, 1-10/3
    if (trimmed.includes("/")) {
      const [rangePart, stepStr] = trimmed.split("/");
      const step = parseInt(stepStr!, 10);
      if (isNaN(step) || step <= 0) continue;

      let start = min;
      let end = max;

      if (rangePart !== "*") {
        if (rangePart!.includes("-")) {
          const [a, b] = rangePart!.split("-");
          start = parseInt(a!, 10);
          end = parseInt(b!, 10);
        } else {
          start = parseInt(rangePart!, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    }
    // 范围: 1-5
    else if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-");
      const start = parseInt(a!, 10);
      const end = parseInt(b!, 10);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    }
    // 通配符
    else if (trimmed === "*") {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    }
    // 单个值
    else {
      const val = parseInt(trimmed, 10);
      if (!isNaN(val) && val >= min && val <= max) {
        values.add(val);
      }
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * 计算 Cron 表达式的下次运行时间
 */
function computeNextCronRun(expr: string, nowMs: number, tz?: string): number | undefined {
  const parts = expr.trim().split(/\s+/);
  let seconds: number[], minutes: number[], hours: number[],
    days: number[], months: number[], weekdays: number[];

  if (parts.length === 6) {
    // 秒 分 时 日 月 周
    seconds = parseCronField(parts[0]!, 0, 59);
    minutes = parseCronField(parts[1]!, 0, 59);
    hours = parseCronField(parts[2]!, 0, 23);
    days = parseCronField(parts[3]!, 1, 31);
    months = parseCronField(parts[4]!, 1, 12);
    weekdays = parseCronField(parts[5]!, 0, 6);
  } else if (parts.length === 5) {
    // 分 时 日 月 周
    seconds = [0];
    minutes = parseCronField(parts[0]!, 0, 59);
    hours = parseCronField(parts[1]!, 0, 23);
    days = parseCronField(parts[2]!, 1, 31);
    months = parseCronField(parts[3]!, 1, 12);
    weekdays = parseCronField(parts[4]!, 0, 6);
  } else {
    return undefined;
  }

  // 从 now+1秒 开始搜索，最多搜索 2 年
  const maxSearch = nowMs + 2 * 365 * 24 * 60 * 60 * 1000;
  const now = new Date(nowMs);

  // 从当前分钟开始，逐分钟搜索
  let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds() + 1);

  while (candidate.getTime() < maxSearch) {
    const month = candidate.getMonth() + 1;  // 1-12
    const day = candidate.getDate();
    const weekday = candidate.getDay();       // 0-6
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();
    const second = candidate.getSeconds();

    if (
      months.includes(month) &&
      days.includes(day) &&
      weekdays.includes(weekday) &&
      hours.includes(hour) &&
      minutes.includes(minute) &&
      seconds.includes(second)
    ) {
      return candidate.getTime();
    }

    // 优化搜索步进
    if (!months.includes(month)) {
      // 跳到下个月
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 1);
    } else if (!days.includes(day) || !weekdays.includes(weekday)) {
      // 跳到明天
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + 1);
    } else if (!hours.includes(hour)) {
      // 跳到下一个小时
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(),
        candidate.getHours() + 1, 0, 0);
    } else if (!minutes.includes(minute)) {
      // 跳到下一分钟
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(),
        candidate.getHours(), candidate.getMinutes() + 1, 0);
    } else {
      // 跳到下一秒
      candidate = new Date(candidate.getTime() + 1000);
    }
  }

  return undefined;
}

/**
 * 计算下次运行时间
 */
export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  switch (schedule.kind) {
    case "at":
      // 一次性任务：如果时间已过则返回 undefined
      return schedule.atMs > nowMs ? schedule.atMs : undefined;

    case "every": {
      // 周期性任务：基于锚点的步进对齐
      const anchor = schedule.anchorMs ?? nowMs;
      const everyMs = schedule.everyMs;

      if (everyMs <= 0) return undefined;

      if (nowMs < anchor) {
        return anchor;
      }

      const elapsed = nowMs - anchor;
      const steps = Math.floor(elapsed / everyMs) + 1;
      return anchor + steps * everyMs;
    }

    case "cron":
      return computeNextCronRun(schedule.expr, nowMs, schedule.tz);

    default:
      return undefined;
  }
}

/**
 * 计算任务的下次运行时间
 */
export function computeJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  if (!job.enabled) return undefined;
  return computeNextRunAtMs(job.schedule, nowMs);
}

/**
 * 验证 Cron 表达式
 */
export function validateCronExpr(expr: string): { valid: boolean; error?: string } {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return { valid: false, error: `Expected 5 or 6 fields, got ${parts.length}` };
  }

  // 尝试计算下次时间
  const next = computeNextCronRun(expr, Date.now());
  if (!next) {
    return { valid: false, error: "Expression never matches (within 2 years)" };
  }

  return { valid: true };
}

/**
 * 格式化调度信息
 */
export function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "at":
      return `Once at ${new Date(schedule.atMs).toISOString()}`;
    case "every": {
      const ms = schedule.everyMs;
      if (ms >= 86400000) return `Every ${Math.round(ms / 86400000)}d`;
      if (ms >= 3600000) return `Every ${Math.round(ms / 3600000)}h`;
      if (ms >= 60000) return `Every ${Math.round(ms / 60000)}m`;
      return `Every ${Math.round(ms / 1000)}s`;
    }
    case "cron":
      return `Cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    default:
      return "Unknown schedule";
  }
}
