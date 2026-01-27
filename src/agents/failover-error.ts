/**
 * 故障转移错误类型
 */

/** 故障原因 */
export type FailoverReason =
  | "billing"      // 账单/配额问题 (402)
  | "rate_limit"   // 速率限制 (429)
  | "auth"         // 认证失败 (401/403)
  | "timeout"      // 超时
  | "format"       // 格式错误 (400)
  | "unavailable"  // 服务不可用 (503)
  | "unknown";     // 未知错误

/** 故障转移错误 */
export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    params: {
      reason: FailoverReason;
      provider?: string;
      model?: string;
      status?: number;
      code?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: params.cause });
    this.name = "FailoverError";
    this.reason = params.reason;
    this.provider = params.provider;
    this.model = params.model;
    this.status = params.status;
    this.code = params.code;
  }
}

/** 检查是否为故障转移错误 */
export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

/** 超时相关的错误提示 */
const TIMEOUT_HINT_RE = /timeout|timed out|deadline exceeded|context deadline exceeded/i;
const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;

/** 检查是否为超时错误 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const name = (err as { name?: string }).name ?? "";
  if (name === "TimeoutError") return true;

  const message = (err as { message?: string }).message ?? "";
  if (TIMEOUT_HINT_RE.test(message)) return true;

  if (name === "AbortError" && ABORT_TIMEOUT_RE.test(message)) return true;

  const cause = (err as { cause?: unknown }).cause;
  if (cause && isTimeoutError(cause)) return true;

  return false;
}

/** 获取错误状态码 */
function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof status === "number") return status;
  if (typeof status === "string" && /^\d+$/.test(status)) return Number(status);
  return undefined;
}

/** 获取错误代码 */
function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 获取错误消息 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(err);
}

/** 从错误消息分类故障原因 */
function classifyFailoverReason(message: string): FailoverReason | null {
  const lower = message.toLowerCase();

  if (lower.includes("billing") || lower.includes("quota") || lower.includes("insufficient")) {
    return "billing";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "rate_limit";
  }
  if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return "auth";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "timeout";
  }
  if (lower.includes("bad request") || lower.includes("invalid")) {
    return "format";
  }
  if (lower.includes("unavailable") || lower.includes("overloaded")) {
    return "unavailable";
  }

  return null;
}

/** 从错误推断故障原因 */
export function resolveFailoverReasonFromError(err: unknown): FailoverReason | null {
  if (isFailoverError(err)) return err.reason;

  const status = getStatusCode(err);
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 400) return "format";
  if (status === 503) return "unavailable";

  const code = getErrorCode(err)?.toUpperCase() ?? "";
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(code)) {
    return "timeout";
  }

  if (isTimeoutError(err)) return "timeout";

  const message = getErrorMessage(err);
  return classifyFailoverReason(message);
}

/** 描述故障转移错误 */
export function describeFailoverError(err: unknown): {
  message: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
} {
  if (isFailoverError(err)) {
    return {
      message: err.message,
      reason: err.reason,
      status: err.status,
      code: err.code,
    };
  }

  return {
    message: getErrorMessage(err),
    reason: resolveFailoverReasonFromError(err) ?? undefined,
    status: getStatusCode(err),
    code: getErrorCode(err),
  };
}

/** 将普通错误转换为故障转移错误 */
export function coerceToFailoverError(
  err: unknown,
  context?: {
    provider?: string;
    model?: string;
  }
): FailoverError | null {
  if (isFailoverError(err)) return err;

  const reason = resolveFailoverReasonFromError(err);
  if (!reason) return null;

  return new FailoverError(getErrorMessage(err), {
    reason,
    provider: context?.provider,
    model: context?.model,
    status: getStatusCode(err),
    code: getErrorCode(err),
    cause: err instanceof Error ? err : undefined,
  });
}

/** 根据原因获取建议的状态码 */
export function resolveFailoverStatus(reason: FailoverReason): number | undefined {
  switch (reason) {
    case "billing": return 402;
    case "rate_limit": return 429;
    case "auth": return 401;
    case "timeout": return 408;
    case "format": return 400;
    case "unavailable": return 503;
    default: return undefined;
  }
}
