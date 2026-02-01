/**
 * 定时任务类型定义
 */

/** 调度类型：一次性 */
export interface ScheduleAt {
  kind: "at";
  /** 执行时间 (毫秒时间戳) */
  atMs: number;
}

/** 调度类型：周期性 */
export interface ScheduleEvery {
  kind: "every";
  /** 间隔时间 (毫秒) */
  everyMs: number;
  /** 锚点时间 (用于对齐，毫秒时间戳) */
  anchorMs?: number;
}

/** 调度类型：Cron 表达式 */
export interface ScheduleCron {
  kind: "cron";
  /** Cron 表达式 (支持秒级: "秒 分 时 日 月 周") */
  expr: string;
  /** 时区 (默认系统时区) */
  tz?: string;
}

/** 调度配置 */
export type CronSchedule = ScheduleAt | ScheduleEvery | ScheduleCron;

/** 任务 Payload：系统事件 */
export interface PayloadSystemEvent {
  kind: "systemEvent";
  /** 事件内容 */
  message: string;
}

/** 任务 Payload：Agent 执行 */
export interface PayloadAgentTurn {
  kind: "agentTurn";
  /** 用户消息 */
  message: string;
  /** 指定模型 (可选) */
  model?: string;
  /** 超时时间 (秒) */
  timeoutSeconds?: number;
  /** 是否投递结果 */
  deliver?: boolean;
  /** 投递通道 */
  channel?: string;
  /** 投递目标 */
  to?: string;
}

/** 任务 Payload */
export type CronPayload = PayloadSystemEvent | PayloadAgentTurn;

/** 任务运行状态 */
export interface CronJobState {
  /** 下次运行时间 */
  nextRunAtMs?: number;
  /** 上次运行时间 */
  lastRunAtMs?: number;
  /** 上次运行状态 */
  lastStatus?: "ok" | "error" | "skipped";
  /** 上次运行持续时间 (毫秒) */
  lastDurationMs?: number;
  /** 上次运行错误 */
  lastError?: string;
  /** 当前运行开始时间 (用于防重入) */
  runningAtMs?: number;
  /** 运行次数 */
  runCount?: number;
}

/** 定时任务 */
export interface CronJob {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 调度配置 */
  schedule: CronSchedule;
  /** 任务 Payload */
  payload: CronPayload;
  /** 创建时间 */
  createdAtMs: number;
  /** 更新时间 */
  updatedAtMs: number;
  /** 运行后是否删除 (仅一次性任务) */
  deleteAfterRun?: boolean;
  /** 运行状态 */
  state: CronJobState;
}

/** 创建任务的输入 */
export interface CronJobCreate {
  name: string;
  description?: string;
  enabled?: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  deleteAfterRun?: boolean;
}

/** 更新任务的输入 */
export interface CronJobUpdate {
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: CronSchedule;
  payload?: Partial<CronPayload>;
  deleteAfterRun?: boolean;
}

/** Cron 事件类型 */
export type CronEventAction = "added" | "updated" | "removed" | "started" | "finished";

/** Cron 事件 */
export interface CronEvent {
  jobId: string;
  action: CronEventAction;
  timestamp: number;
  runAtMs?: number;
  durationMs?: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  nextRunAtMs?: number;
}

/** Cron 服务依赖 */
export interface CronServiceDeps {
  /** 自定义时钟 (用于测试) */
  nowMs?: () => number;
  /** 存储文件路径 */
  storePath?: string;
  /** 是否启用调度 */
  enabled?: boolean;
  /** 执行任务的回调 */
  executeJob?: (job: CronJob) => Promise<{ status: "ok" | "error" | "skipped"; error?: string; summary?: string }>;
  /** 事件回调 */
  onEvent?: (event: CronEvent) => void;
}

/** 存储文件格式 */
export interface CronStoreFile {
  version: 1;
  jobs: CronJob[];
}

/** 常用时间常量 */
export const TIME_CONSTANTS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

/** 卡死任务检测阈值 (2 小时) */
export const STUCK_RUN_MS = 2 * TIME_CONSTANTS.HOUR;
