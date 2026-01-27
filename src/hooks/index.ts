/**
 * Hooks 系统 - 事件钩子
 */

import { getChildLogger } from "../utils/logger.js";
import type { InboundMessageContext, ChatMessage, ProviderId } from "../types/index.js";

const logger = getChildLogger("hooks");

// ============== 事件类型 ==============

/** Hook 事件类型 */
export type HookEventType =
  | "message_received"      // 收到消息
  | "message_sending"       // 即将发送消息
  | "message_sent"          // 消息已发送
  | "agent_start"           // Agent 开始处理
  | "agent_end"             // Agent 处理完成
  | "tool_start"            // 工具开始执行
  | "tool_end"              // 工具执行完成
  | "session_start"         // 会话开始
  | "session_end"           // 会话结束
  | "compaction_start"      // 压缩开始
  | "compaction_end"        // 压缩完成
  | "error";                // 发生错误

/** Hook 事件数据基础 */
interface HookEventBase {
  type: HookEventType;
  timestamp: number;
  sessionKey?: string;
}

/** 消息接收事件 */
export interface MessageReceivedEvent extends HookEventBase {
  type: "message_received";
  context: InboundMessageContext;
}

/** 消息发送事件 */
export interface MessageSendingEvent extends HookEventBase {
  type: "message_sending";
  channelId: string;
  chatId: string;
  content: string;
  replyToId?: string;
}

/** 消息已发送事件 */
export interface MessageSentEvent extends HookEventBase {
  type: "message_sent";
  channelId: string;
  chatId: string;
  messageId?: string;
  success: boolean;
}

/** Agent 开始事件 */
export interface AgentStartEvent extends HookEventBase {
  type: "agent_start";
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
}

/** Agent 结束事件 */
export interface AgentEndEvent extends HookEventBase {
  type: "agent_end";
  provider: ProviderId;
  model: string;
  response: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs: number;
}

/** 工具开始事件 */
export interface ToolStartEvent extends HookEventBase {
  type: "tool_start";
  toolName: string;
  toolCallId: string;
  arguments: unknown;
}

/** 工具结束事件 */
export interface ToolEndEvent extends HookEventBase {
  type: "tool_end";
  toolName: string;
  toolCallId: string;
  result: unknown;
  isError: boolean;
  durationMs: number;
}

/** 会话开始事件 */
export interface SessionStartEvent extends HookEventBase {
  type: "session_start";
  channelId: string;
  chatId: string;
  senderId: string;
}

/** 会话结束事件 */
export interface SessionEndEvent extends HookEventBase {
  type: "session_end";
  messageCount: number;
  totalTokens: number;
}

/** 压缩开始事件 */
export interface CompactionStartEvent extends HookEventBase {
  type: "compaction_start";
  messageCount: number;
  estimatedTokens: number;
}

/** 压缩结束事件 */
export interface CompactionEndEvent extends HookEventBase {
  type: "compaction_end";
  compactedMessages: number;
  summaryLength: number;
  durationMs: number;
}

/** 错误事件 */
export interface ErrorEvent extends HookEventBase {
  type: "error";
  error: Error;
  context?: string;
}

/** 所有事件类型 */
export type HookEvent =
  | MessageReceivedEvent
  | MessageSendingEvent
  | MessageSentEvent
  | AgentStartEvent
  | AgentEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | SessionStartEvent
  | SessionEndEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | ErrorEvent;

// ============== Hook 处理器 ==============

/** Hook 处理器 */
export type HookHandler<T extends HookEvent = HookEvent> = (
  event: T
) => void | Promise<void>;

/** Hook 处理器带返回值 (用于修改事件) */
export type HookTransformer<T extends HookEvent = HookEvent> = (
  event: T
) => T | Promise<T>;

/** Hook 注册表 */
const hookRegistry = new Map<HookEventType, Array<HookHandler>>();

// ============== Hook 管理 ==============

/** 注册 Hook */
export function registerHook<T extends HookEventType>(
  eventType: T,
  handler: HookHandler
): () => void {
  const handlers = hookRegistry.get(eventType) ?? [];
  handlers.push(handler);
  hookRegistry.set(eventType, handlers);

  logger.debug({ eventType }, "Hook registered");

  // 返回取消注册函数
  return () => {
    const currentHandlers = hookRegistry.get(eventType);
    if (currentHandlers) {
      const index = currentHandlers.indexOf(handler);
      if (index >= 0) {
        currentHandlers.splice(index, 1);
      }
    }
  };
}

/** 批量注册 Hooks */
export function registerHooks(
  hooks: Partial<Record<HookEventType, HookHandler>>
): () => void {
  const unsubscribers: Array<() => void> = [];

  for (const [eventType, handler] of Object.entries(hooks)) {
    if (handler) {
      unsubscribers.push(registerHook(eventType as HookEventType, handler));
    }
  }

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/** 触发 Hook */
export async function triggerHook(event: HookEvent): Promise<void> {
  const handlers = hookRegistry.get(event.type);
  if (!handlers || handlers.length === 0) return;

  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (error) {
      logger.error({ error, eventType: event.type }, "Hook handler error");
    }
  }
}

/** 同步触发 Hook (不等待) */
export function triggerHookSync(event: HookEvent): void {
  triggerHook(event).catch((error) => {
    logger.error({ error, eventType: event.type }, "Hook trigger error");
  });
}

/** 清除所有 Hooks */
export function clearHooks(): void {
  hookRegistry.clear();
}

/** 获取已注册的 Hook 数量 */
export function getHookCount(eventType?: HookEventType): number {
  if (eventType) {
    return hookRegistry.get(eventType)?.length ?? 0;
  }
  let count = 0;
  for (const handlers of hookRegistry.values()) {
    count += handlers.length;
  }
  return count;
}

// ============== 便捷函数 ==============

/** 创建事件基础数据 */
function createEventBase<T extends HookEventType>(
  type: T,
  sessionKey?: string
): HookEventBase & { type: T } {
  return {
    type,
    timestamp: Date.now(),
    sessionKey,
  };
}

/** 触发消息接收事件 */
export function emitMessageReceived(context: InboundMessageContext): void {
  triggerHookSync({
    ...createEventBase("message_received"),
    context,
  });
}

/** 触发消息发送事件 */
export function emitMessageSending(params: {
  channelId: string;
  chatId: string;
  content: string;
  replyToId?: string;
  sessionKey?: string;
}): void {
  triggerHookSync({
    ...createEventBase("message_sending", params.sessionKey),
    channelId: params.channelId,
    chatId: params.chatId,
    content: params.content,
    replyToId: params.replyToId,
  });
}

/** 触发 Agent 开始事件 */
export function emitAgentStart(params: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  sessionKey?: string;
}): void {
  triggerHookSync({
    ...createEventBase("agent_start", params.sessionKey),
    provider: params.provider,
    model: params.model,
    messages: params.messages,
  });
}

/** 触发 Agent 结束事件 */
export function emitAgentEnd(params: {
  provider: ProviderId;
  model: string;
  response: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
  sessionKey?: string;
}): void {
  triggerHookSync({
    ...createEventBase("agent_end", params.sessionKey),
    provider: params.provider,
    model: params.model,
    response: params.response,
    usage: params.usage,
    durationMs: params.durationMs,
  });
}

/** 触发工具事件 */
export function emitToolStart(params: {
  toolName: string;
  toolCallId: string;
  arguments: unknown;
  sessionKey?: string;
}): void {
  triggerHookSync({
    ...createEventBase("tool_start", params.sessionKey),
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    arguments: params.arguments,
  });
}

export function emitToolEnd(params: {
  toolName: string;
  toolCallId: string;
  result: unknown;
  isError: boolean;
  durationMs: number;
  sessionKey?: string;
}): void {
  triggerHookSync({
    ...createEventBase("tool_end", params.sessionKey),
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    result: params.result,
    isError: params.isError,
    durationMs: params.durationMs,
  });
}

/** 触发错误事件 */
export function emitError(error: Error, context?: string): void {
  triggerHookSync({
    ...createEventBase("error"),
    error,
    context,
  });
}
