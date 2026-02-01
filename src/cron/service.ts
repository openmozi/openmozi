/**
 * 定时任务服务
 *
 * 参考 moltbot 的 cron service 实现
 * 提供任务管理、调度执行、事件通知等功能
 */

import { randomUUID } from "crypto";
import type {
  CronJob,
  CronJobCreate,
  CronJobUpdate,
  CronServiceDeps,
  CronEvent,
  CronEventAction,
} from "./types.js";
import { STUCK_RUN_MS } from "./types.js";
import { CronStore, DEFAULT_CRON_STORE_PATH } from "./store.js";
import { computeJobNextRunAtMs, formatSchedule } from "./schedule.js";

/** setTimeout 的最大安全值 (~24.8 天) */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 定时任务服务
 */
export class CronService {
  private deps: Required<CronServiceDeps>;
  private store: CronStore;
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private started: boolean = false;

  constructor(deps?: CronServiceDeps) {
    this.deps = {
      nowMs: deps?.nowMs ?? (() => Date.now()),
      storePath: deps?.storePath ?? DEFAULT_CRON_STORE_PATH,
      enabled: deps?.enabled ?? true,
      executeJob: deps?.executeJob ?? (async () => ({ status: "ok" as const })),
      onEvent: deps?.onEvent ?? (() => {}),
    };
    this.store = new CronStore(this.deps.storePath);
  }

  /** 启动服务 */
  start(): void {
    if (this.started) return;
    this.started = true;

    // 重新计算所有任务的下次运行时间
    this.recomputeAllNextRuns();

    // 设置定时器
    if (this.deps.enabled) {
      this.armTimer();
    }
  }

  /** 停止服务 */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 列出所有任务 */
  list(options?: { includeDisabled?: boolean }): CronJob[] {
    const { includeDisabled = false } = options || {};
    const jobs = this.store.getJobs();

    return (includeDisabled ? jobs : jobs.filter(j => j.enabled))
      .sort((a, b) => (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity));
  }

  /** 获取单个任务 */
  get(id: string): CronJob | undefined {
    return this.store.getJob(id);
  }

  /** 按名称获取任务 */
  getByName(name: string): CronJob | undefined {
    return this.store.getJobByName(name);
  }

  /** 添加任务 */
  add(input: CronJobCreate): CronJob {
    const now = this.deps.nowMs();
    const id = randomUUID();

    const job: CronJob = {
      id,
      name: input.name,
      description: input.description,
      enabled: input.enabled ?? true,
      schedule: input.schedule,
      payload: input.payload,
      deleteAfterRun: input.deleteAfterRun,
      createdAtMs: now,
      updatedAtMs: now,
      state: {},
    };

    // 计算下次运行时间
    job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);

    this.store.addJob(job);
    this.store.persist();

    this.emit(job.id, "added", { nextRunAtMs: job.state.nextRunAtMs });
    this.armTimer();

    return job;
  }

  /** 更新任务 */
  update(id: string, patch: CronJobUpdate): CronJob | undefined {
    const job = this.store.getJob(id);
    if (!job) return undefined;

    const now = this.deps.nowMs();

    // 应用更新
    if (patch.name !== undefined) job.name = patch.name;
    if (patch.description !== undefined) job.description = patch.description;
    if (patch.enabled !== undefined) job.enabled = patch.enabled;
    if (patch.schedule !== undefined) job.schedule = patch.schedule;
    if (patch.deleteAfterRun !== undefined) job.deleteAfterRun = patch.deleteAfterRun;

    // 合并 payload
    if (patch.payload) {
      if (patch.payload.kind && patch.payload.kind !== job.payload.kind) {
        job.payload = patch.payload as typeof job.payload;
      } else {
        Object.assign(job.payload, patch.payload);
      }
    }

    job.updatedAtMs = now;

    // 重新计算下次运行时间
    job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);

    this.store.updateJob(id, job);
    this.store.persist();

    this.emit(job.id, "updated", { nextRunAtMs: job.state.nextRunAtMs });
    this.armTimer();

    return job;
  }

  /** 删除任务 */
  remove(id: string): boolean {
    const removed = this.store.removeJob(id);
    if (removed) {
      this.store.persist();
      this.emit(id, "removed");
      this.armTimer();
    }
    return removed;
  }

  /** 立即运行任务 */
  async run(id: string, options?: { forced?: boolean }): Promise<{
    status: "ok" | "error" | "skipped" | "not_found";
    error?: string;
    summary?: string;
  }> {
    const job = this.store.getJob(id);
    if (!job) {
      return { status: "not_found", error: "Job not found" };
    }

    return this.executeJob(job, { forced: options?.forced ?? true });
  }

  /** 重新加载存储 */
  reload(): void {
    this.store.reload();
    this.recomputeAllNextRuns();
    this.armTimer();
  }

  // ============== 私有方法 ==============

  /** 发送事件 */
  private emit(jobId: string, action: CronEventAction, extra?: Partial<CronEvent>): void {
    const event: CronEvent = {
      jobId,
      action,
      timestamp: this.deps.nowMs(),
      ...extra,
    };
    this.deps.onEvent(event);
  }

  /** 重新计算所有任务的下次运行时间 */
  private recomputeAllNextRuns(): void {
    const now = this.deps.nowMs();
    let changed = false;

    for (const job of this.store.getJobs()) {
      // 清除卡死的运行状态
      if (
        typeof job.state.runningAtMs === "number" &&
        now - job.state.runningAtMs > STUCK_RUN_MS
      ) {
        job.state.runningAtMs = undefined;
        changed = true;
      }

      // 重新计算下次运行时间
      const next = computeJobNextRunAtMs(job, now);
      if (next !== job.state.nextRunAtMs) {
        job.state.nextRunAtMs = next;
        changed = true;
      }
    }

    if (changed) {
      this.store.persist();
    }
  }

  /** 设置定时器 */
  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.started || !this.deps.enabled) return;

    // 找到最近需要运行的任务
    const now = this.deps.nowMs();
    let nearestMs: number | undefined;

    for (const job of this.store.getEnabledJobs()) {
      const next = job.state.nextRunAtMs;
      if (next && (nearestMs === undefined || next < nearestMs)) {
        nearestMs = next;
      }
    }

    if (nearestMs === undefined) return;

    const delay = Math.min(Math.max(nearestMs - now, 0), MAX_TIMEOUT_MS);

    this.timer = setTimeout(() => {
      this.onTimer();
    }, delay);

    // 不阻止进程退出
    this.timer.unref?.();
  }

  /** 定时器触发 */
  private async onTimer(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.runDueJobs();
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  /** 运行到期的任务 */
  private async runDueJobs(): Promise<void> {
    const now = this.deps.nowMs();
    const dueJobs = this.store.getEnabledJobs().filter(job =>
      typeof job.state.runningAtMs !== "number" &&
      job.state.nextRunAtMs !== undefined &&
      now >= job.state.nextRunAtMs
    );

    for (const job of dueJobs) {
      await this.executeJob(job, { forced: false });
    }
  }

  /** 执行单个任务 */
  private async executeJob(
    job: CronJob,
    options: { forced: boolean }
  ): Promise<{
    status: "ok" | "error" | "skipped";
    error?: string;
    summary?: string;
  }> {
    const startMs = this.deps.nowMs();

    // 标记为运行中
    job.state.runningAtMs = startMs;
    this.store.updateJob(job.id, job);
    this.store.persist();

    this.emit(job.id, "started", { runAtMs: startMs });

    let status: "ok" | "error" | "skipped" = "ok";
    let error: string | undefined;
    let summary: string | undefined;
    let deleted = false;

    try {
      const result = await this.deps.executeJob(job);
      status = result.status;
      error = result.error;
      summary = result.summary;
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }

    const endMs = this.deps.nowMs();
    const durationMs = endMs - startMs;

    // 更新状态
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startMs;
    job.state.lastStatus = status;
    job.state.lastDurationMs = durationMs;
    job.state.lastError = error;
    job.state.runCount = (job.state.runCount ?? 0) + 1;

    // 一次性任务完成后的处理
    if (job.schedule.kind === "at" && status === "ok") {
      if (job.deleteAfterRun) {
        this.store.removeJob(job.id);
        deleted = true;
      } else {
        job.enabled = false;
      }
    }

    // 重新计算下次运行时间
    if (!options.forced && job.enabled && !deleted) {
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, endMs);
    }

    // 将更新后的 job 保存到 store（确保 dirty 标志被设置）
    if (!deleted) {
      this.store.updateJob(job.id, job);
    }
    this.store.persist();

    this.emit(job.id, "finished", {
      runAtMs: startMs,
      durationMs,
      status,
      error,
      summary,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    return { status, error, summary };
  }
}

/** 默认服务实例 */
let defaultService: CronService | null = null;

/** 获取默认 Cron 服务 */
export function getCronService(deps?: CronServiceDeps): CronService {
  if (!defaultService) {
    defaultService = new CronService(deps);
  }
  return defaultService;
}
