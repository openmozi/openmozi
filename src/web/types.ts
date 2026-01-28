/**
 * Web 模块类型定义
 */

/** WebSocket 请求帧 */
export interface WsRequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

/** WebSocket 响应帧 */
export interface WsResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** WebSocket 事件帧 */
export interface WsEventFrame {
  type: "event";
  event: string;
  payload?: unknown;
}

/** WebSocket 帧类型 */
export type WsFrame = WsRequestFrame | WsResponseFrame | WsEventFrame;

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/** 聊天请求参数 */
export interface ChatSendParams {
  message: string;
  sessionKey?: string;
}

/** 会话列表请求参数 */
export interface SessionsListParams {
  limit?: number;
  activeMinutes?: number;
  search?: string;
}

/** 会话历史请求参数 */
export interface SessionsHistoryParams {
  sessionKey: string;
}

/** 会话删除请求参数 */
export interface SessionsDeleteParams {
  sessionKey: string;
}

/** 会话重置请求参数 */
export interface SessionsResetParams {
  sessionKey: string;
}

/** 恢复会话请求参数 */
export interface SessionsRestoreParams {
  sessionKey: string;
}

/** 聊天流事件 */
export interface ChatDeltaEvent {
  sessionId: string;
  delta: string;
  done: boolean;
}

/** 会话信息 */
export interface SessionInfo {
  id: string;
  messageCount: number;
  lastUpdate: number;
  provider: string;
  model: string;
}

/** 系统状态 */
export interface SystemStatus {
  version: string;
  uptime: number;
  providers: Array<{
    id: string;
    name: string;
    available: boolean;
  }>;
  channels: Array<{
    id: string;
    name: string;
    connected: boolean;
  }>;
  sessions: number;
}
