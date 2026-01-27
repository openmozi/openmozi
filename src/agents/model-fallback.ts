/**
 * 模型故障转移系统
 */

import type { ProviderId, MoziConfig } from "../types/index.js";
import { getProvider, getAllProviders } from "../providers/index.js";
import {
  FailoverError,
  isFailoverError,
  coerceToFailoverError,
  describeFailoverError,
  isTimeoutError,
  type FailoverReason,
} from "./failover-error.js";
import { getChildLogger } from "../utils/logger.js";
import { delay } from "../utils/index.js";

const logger = getChildLogger("failover");

/** 模型候选 */
interface ModelCandidate {
  provider: ProviderId;
  model: string;
}

/** 故障尝试记录 */
export interface FallbackAttempt {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
}

/** 冷却时间记录 */
const cooldownMap = new Map<string, number>();

/** 冷却时间 (毫秒) */
const COOLDOWN_DURATION: Record<FailoverReason, number> = {
  billing: 3600000,    // 1 小时
  rate_limit: 60000,   // 1 分钟
  auth: 300000,        // 5 分钟
  timeout: 30000,      // 30 秒
  format: 0,           // 不冷却
  unavailable: 60000,  // 1 分钟
  unknown: 10000,      // 10 秒
};

/** 获取冷却键 */
function getCooldownKey(provider: string, model?: string): string {
  return model ? `${provider}:${model}` : provider;
}

/** 检查是否在冷却中 */
export function isInCooldown(provider: string, model?: string): boolean {
  const key = getCooldownKey(provider, model);
  const until = cooldownMap.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownMap.delete(key);
    return false;
  }
  return true;
}

/** 设置冷却 */
export function setCooldown(provider: string, reason: FailoverReason, model?: string): void {
  const duration = COOLDOWN_DURATION[reason] ?? COOLDOWN_DURATION.unknown;
  if (duration <= 0) return;

  const key = getCooldownKey(provider, model);
  cooldownMap.set(key, Date.now() + duration);
  logger.debug({ provider, model, reason, durationMs: duration }, "Set cooldown");
}

/** 清除冷却 */
export function clearCooldown(provider: string, model?: string): void {
  const key = getCooldownKey(provider, model);
  cooldownMap.delete(key);
}

/** 清除所有冷却 */
export function clearAllCooldowns(): void {
  cooldownMap.clear();
}

/** 检查是否为中止错误 (不应重试) */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (isFailoverError(err)) return false;
  const name = (err as { name?: string }).name ?? "";
  return name === "AbortError";
}

/** 检查是否应该重新抛出中止错误 */
function shouldRethrowAbort(err: unknown): boolean {
  return isAbortError(err) && !isTimeoutError(err);
}

/** 解析故障转移候选列表 */
function resolveFallbackCandidates(params: {
  config?: MoziConfig;
  provider: ProviderId;
  model: string;
  fallbacks?: Array<{ provider: ProviderId; model: string }>;
}): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (provider: ProviderId, model: string) => {
    const key = `${provider}:${model}`;
    if (seen.has(key)) return;
    seen.add(key);

    // 检查提供商是否可用
    if (!getProvider(provider)) return;

    candidates.push({ provider, model });
  };

  // 首选
  addCandidate(params.provider, params.model);

  // 指定的回退列表
  if (params.fallbacks) {
    for (const fb of params.fallbacks) {
      addCandidate(fb.provider, fb.model);
    }
  }

  // 默认回退: 同提供商的其他模型
  const primaryProvider = getProvider(params.provider);
  if (primaryProvider) {
    for (const modelDef of primaryProvider.getModels()) {
      if (modelDef.id !== params.model) {
        addCandidate(params.provider, modelDef.id);
      }
    }
  }

  // 默认回退: 其他提供商
  const otherProviders = getAllProviders().filter((p) => p.id !== params.provider);
  for (const provider of otherProviders) {
    const firstModel = provider.getModels()[0];
    if (firstModel) {
      addCandidate(provider.id, firstModel.id);
    }
  }

  return candidates;
}

/** 带模型故障转移执行 */
export async function runWithModelFallback<T>(params: {
  config?: MoziConfig;
  provider: ProviderId;
  model: string;
  fallbacks?: Array<{ provider: ProviderId; model: string }>;
  run: (provider: ProviderId, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: string;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
  retryDelay?: number;
  maxRetries?: number;
}): Promise<{
  result: T;
  provider: ProviderId;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidates = resolveFallbackCandidates({
    config: params.config,
    provider: params.provider,
    model: params.model,
    fallbacks: params.fallbacks,
  });

  if (candidates.length === 0) {
    throw new Error(`No available providers for ${params.provider}/${params.model}`);
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;
  const retryDelay = params.retryDelay ?? 1000;
  const maxRetries = params.maxRetries ?? 1;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;

    // 检查冷却
    if (isInCooldown(candidate.provider, candidate.model)) {
      logger.debug({ ...candidate }, "Skipping candidate in cooldown");
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: "Provider is in cooldown",
        reason: "rate_limit",
      });
      continue;
    }

    // 重试循环
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        logger.debug({ ...candidate, attempt: i + 1, retry }, "Trying candidate");

        const result = await params.run(candidate.provider, candidate.model);

        return {
          result,
          provider: candidate.provider,
          model: candidate.model,
          attempts,
        };
      } catch (err) {
        // 检查是否应该重新抛出
        if (shouldRethrowAbort(err)) throw err;

        // 转换为故障转移错误
        const failoverErr = coerceToFailoverError(err, {
          provider: candidate.provider,
          model: candidate.model,
        });

        if (!failoverErr && !isFailoverError(err)) {
          // 不是可恢复的错误
          throw err;
        }

        lastError = failoverErr ?? err;
        const described = describeFailoverError(lastError);

        // 记录尝试
        if (retry === maxRetries) {
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: described.message,
            reason: described.reason,
            status: described.status,
            code: described.code,
          });
        }

        // 设置冷却
        if (described.reason) {
          setCooldown(candidate.provider, described.reason, candidate.model);
        }

        // 通知错误
        await params.onError?.({
          provider: candidate.provider,
          model: candidate.model,
          error: lastError,
          attempt: i + 1,
          total: candidates.length,
        });

        logger.warn(
          { ...candidate, error: described.message, reason: described.reason, retry },
          "Candidate failed"
        );

        // 重试延迟
        if (retry < maxRetries) {
          await delay(retryDelay * (retry + 1));
        }
      }
    }
  }

  // 所有候选都失败
  if (attempts.length <= 1 && lastError) {
    throw lastError;
  }

  const summary = attempts
    .map((a) => `${a.provider}/${a.model}: ${a.error}${a.reason ? ` (${a.reason})` : ""}`)
    .join(" | ");

  throw new Error(`All models failed (${attempts.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

/** 简化的重试执行 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    retryDelay?: number;
    onError?: (error: unknown, attempt: number) => void;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const retryDelay = options?.retryDelay ?? 1000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (shouldRethrowAbort(err)) throw err;

      lastError = err;
      options?.onError?.(err, attempt);

      if (attempt < maxRetries) {
        await delay(retryDelay * attempt);
      }
    }
  }

  throw lastError;
}
