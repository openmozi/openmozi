/**
 * WebSocket 服务器 - 提供实时通信
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { getChildLogger } from "../utils/logger.js";
import { generateId } from "../utils/index.js";
import type {
  WsFrame,
  WsRequestFrame,
  WsResponseFrame,
  WsEventFrame,
  ChatSendParams,
  ChatDeltaEvent,
  SystemStatus,
  SessionsListParams,
  SessionsHistoryParams,
  SessionsDeleteParams,
  SessionsResetParams,
  SessionsRestoreParams,
} from "./types.js";
import type { Agent } from "../agents/agent.js";
import type { MoziConfig } from "../types/index.js";
import { getAllProviders } from "../providers/index.js";
import { getAllChannels } from "../channels/index.js";
import { getSessionStore, type TranscriptMessage } from "../sessions/index.js";
const logger = getChildLogger("websocket");

/** WebSocket 客户端 */
interface WsClient {
  id: string;
  ws: WebSocket;
  sessionKey: string | null;  // null 表示尚未绑定 session
  sessionId: string | null;
  lastPing: number;
}

/** WebSocket 服务选项 */
export interface WsServerOptions {
  server: HttpServer;
  agent: Agent;
  config: MoziConfig;
  /** 心跳检测间隔 (毫秒), 默认 30000 */
  heartbeatInterval?: number;
  /** 客户端超时时间 (毫秒), 默认 60000 */
  clientTimeout?: number;
}

/** WebSocket 服务器类 */
export class WsServer {
  private wss: WebSocketServer;
  private clients = new Map<string, WsClient>();
  private agent: Agent;
  private config: MoziConfig;
  private startTime = Date.now();
  private heartbeatInterval: number;
  private clientTimeout: number;

  constructor(options: WsServerOptions) {
    this.agent = options.agent;
    this.config = options.config;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.clientTimeout = options.clientTimeout ?? 60000;

    this.wss = new WebSocketServer({
      server: options.server,
      path: "/ws",
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws);
    });

    // 心跳检测
    setInterval(() => this.checkHeartbeat(), this.heartbeatInterval);

    logger.info("WebSocket server initialized");
  }

  /** 处理新连接 */
  private async handleConnection(ws: WebSocket): Promise<void> {
    const clientId = generateId("client");

    // 不立即创建 session，等待客户端发送 sessions.restore 或 chat.send 时再创建
    const client: WsClient = {
      id: clientId,
      ws,
      sessionKey: null,
      sessionId: null,
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);
    logger.info({ clientId }, "Client connected");

    // 发送欢迎消息 - 不包含 session 信息，等待客户端决定
    this.sendEvent(ws, "connected", {
      clientId,
      version: "1.0.0",
    });

    ws.on("message", (data) => {
      this.handleMessage(client, data.toString());
    });

    ws.on("close", () => {
      this.clients.delete(clientId);
      logger.info({ clientId }, "Client disconnected");
    });

    ws.on("error", (error) => {
      logger.error({ clientId, error }, "WebSocket error");
    });

    ws.on("pong", () => {
      client.lastPing = Date.now();
    });
  }

  /** 处理消息 */
  private async handleMessage(client: WsClient, data: string): Promise<void> {
    try {
      const frame = JSON.parse(data) as WsFrame;

      if (frame.type === "req") {
        await this.handleRequest(client, frame);
      }
    } catch (error) {
      logger.error({ error, data }, "Failed to handle message");
    }
  }

  /** 处理请求 */
  private async handleRequest(
    client: WsClient,
    frame: WsRequestFrame
  ): Promise<void> {
    const { id, method, params } = frame;

    try {
      let result: unknown;

      switch (method) {
        case "chat.send":
          result = await this.handleChatSend(client, params as ChatSendParams);
          break;
        case "chat.clear":
          result = await this.handleChatClear(client);
          break;
        case "sessions.list":
          result = await this.handleSessionsList(params as SessionsListParams);
          break;
        case "sessions.history":
          result = await this.handleSessionsHistory(params as SessionsHistoryParams);
          break;
        case "sessions.delete":
          result = await this.handleSessionsDelete(params as SessionsDeleteParams);
          break;
        case "sessions.reset":
          result = await this.handleSessionsReset(params as SessionsResetParams);
          break;
        case "sessions.restore":
          result = await this.handleSessionsRestore(client, params as SessionsRestoreParams);
          break;
        case "status.get":
          result = this.getSystemStatus();
          break;
        case "session.info":
          result = this.getSessionInfo(client);
          break;
        case "ping":
          result = { pong: Date.now() };
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      this.sendResponse(client.ws, id, true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendResponse(client.ws, id, false, undefined, {
        code: "ERROR",
        message,
      });
    }
  }

  /** 确保客户端有 session，如果没有则创建 */
  private async ensureSession(client: WsClient): Promise<void> {
    if (client.sessionKey && client.sessionId) {
      return;
    }

    const store = getSessionStore();
    const sessionKey = `webchat:${client.id}`;
    const session = await store.getOrCreate(sessionKey);

    client.sessionKey = sessionKey;
    client.sessionId = session.sessionId;

    logger.info({ clientId: client.id, sessionKey, sessionId: session.sessionId }, "Session created");
  }

  /** 处理聊天发送 */
  private async handleChatSend(
    client: WsClient,
    params: ChatSendParams
  ): Promise<{ messageId: string }> {
    // 确保有 session
    await this.ensureSession(client);

    const { message } = params;
    const messageId = generateId("msg");
    const store = getSessionStore();

    // 构造消息上下文
    // 使用 sessionKey 作为 senderId，确保会话恢复后 Agent 能找到历史上下文
    const stableSenderId = client.sessionKey!.replace("webchat:", "");

    logger.debug(
      { clientId: client.id, sessionKey: client.sessionKey, stableSenderId, message: message.slice(0, 100) },
      "Chat send"
    );

    // 保存用户消息到 transcript
    const userMessage: TranscriptMessage = {
      id: messageId,
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    await store.appendTranscript(client.sessionId!, client.sessionKey!, userMessage);

    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionKey!,
      messageId,
      senderId: stableSenderId,
      senderName: "WebChat User",
      content: message,
      chatType: "direct" as const,
      timestamp: Date.now(),
    };

    // 流式处理
    try {
      const stream = this.agent.processMessageStream(context);
      let fullContent = "";

      for await (const delta of stream) {
        fullContent += delta;
        this.sendEvent(client.ws, "chat.delta", {
          sessionId: client.sessionId,
          delta,
          done: false,
        } as ChatDeltaEvent);
      }

      // 保存助手消息到 transcript
      const assistantMessage: TranscriptMessage = {
        id: generateId("msg"),
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
      };
      await store.appendTranscript(client.sessionId!, client.sessionKey!, assistantMessage);

      // 发送完成事件
      this.sendEvent(client.ws, "chat.delta", {
        sessionId: client.sessionId,
        delta: "",
        done: true,
      } as ChatDeltaEvent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendEvent(client.ws, "chat.error", {
        sessionId: client.sessionId,
        error: errorMessage,
      });
    }

    return { messageId };
  }

  /** 处理清除会话 */
  private async handleChatClear(client: WsClient): Promise<{ success: boolean; sessionKey: string; sessionId: string }> {
    // 确保有 session
    await this.ensureSession(client);

    const store = getSessionStore();
    const oldSessionKey = client.sessionKey!;

    // 重置会话
    const newSession = await store.reset(client.sessionKey!);

    // 更新客户端会话 ID 和 sessionKey
    client.sessionKey = newSession.sessionKey;
    client.sessionId = newSession.sessionId;

    logger.info(
      { clientId: client.id, oldSessionKey, newSessionKey: newSession.sessionKey, newSessionId: newSession.sessionId },
      "Chat cleared, new session created"
    );

    return {
      success: true,
      sessionKey: newSession.sessionKey,
      sessionId: newSession.sessionId,
    };
  }

  /** 处理会话列表 */
  private async handleSessionsList(params?: SessionsListParams): Promise<unknown> {
    const store = getSessionStore();
    const sessions = await store.list({
      limit: params?.limit,
      activeMinutes: params?.activeMinutes,
      search: params?.search,
    });
    return { sessions };
  }

  /** 处理获取会话历史 */
  private async handleSessionsHistory(params: SessionsHistoryParams): Promise<unknown> {
    const store = getSessionStore();
    const session = await store.get(params.sessionKey);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionKey}`);
    }
    const messages = await store.loadTranscript(session.sessionId);
    return {
      sessionKey: params.sessionKey,
      sessionId: session.sessionId,
      messages,
    };
  }

  /** 处理删除会话 */
  private async handleSessionsDelete(params: SessionsDeleteParams): Promise<{ success: boolean }> {
    const store = getSessionStore();
    await store.delete(params.sessionKey);
    return { success: true };
  }

  /** 处理重置会话 */
  private async handleSessionsReset(params: SessionsResetParams): Promise<unknown> {
    const store = getSessionStore();
    const session = await store.reset(params.sessionKey);
    return {
      success: true,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
    };
  }

  /** 处理恢复会话 */
  private async handleSessionsRestore(client: WsClient, params: SessionsRestoreParams): Promise<unknown> {
    const store = getSessionStore();
    const session = await store.get(params.sessionKey);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionKey}`);
    }

    // 更新客户端会话
    client.sessionKey = session.sessionKey;
    client.sessionId = session.sessionId;

    // 加载历史消息
    const messages = await store.loadTranscript(session.sessionId);

    // 恢复 Agent 的会话上下文
    // Agent 使用 "webchat:{senderId}" 作为 sessionKey，对于 direct chat
    // senderId 从 sessionKey 中提取（去掉 "webchat:" 前缀）
    const agentSessionKey = session.sessionKey; // webchat:session_xxx
    const transcriptMessages = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

    if (transcriptMessages.length > 0) {
      this.agent.restoreSessionFromTranscript(agentSessionKey, transcriptMessages);
    }

    return {
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      messages,
    };
  }

  /** 获取系统状态 */
  private getSystemStatus(): SystemStatus {
    const providers = getAllProviders().map((p) => ({
      id: p.id,
      name: p.name,
      available: true,
    }));

    const channels = getAllChannels().map((c) => ({
      id: c.id,
      name: c.id,  // 使用 id 作为 name
      connected: true,  // 简化：假设已配置的通道都是连接的
    }));

    return {
      version: "1.0.0",
      uptime: Date.now() - this.startTime,
      providers,
      channels,
      sessions: this.clients.size,
    };
  }

  /** 获取会话信息 */
  private getSessionInfo(client: WsClient): unknown {
    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionKey || `webchat:${client.id}`,
      messageId: "",
      senderId: client.id,
      senderName: "",
      content: "",
      chatType: "direct" as const,
      timestamp: Date.now(),
    };

    const info = this.agent.getSessionInfo(context);
    return {
      sessionKey: client.sessionKey,
      sessionId: client.sessionId,
      ...info,
    };
  }

  /** 发送响应 */
  private sendResponse(
    ws: WebSocket,
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { code: string; message: string }
  ): void {
    const frame: WsResponseFrame = { type: "res", id, ok, payload, error };
    ws.send(JSON.stringify(frame));
  }

  /** 发送事件 */
  private sendEvent(ws: WebSocket, event: string, payload?: unknown): void {
    const frame: WsEventFrame = { type: "event", event, payload };
    ws.send(JSON.stringify(frame));
  }

  /** 广播事件 */
  broadcast(event: string, payload?: unknown): void {
    const frame: WsEventFrame = { type: "event", event, payload };
    const data = JSON.stringify(frame);

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** 心跳检测 */
  private checkHeartbeat(): void {
    const now = Date.now();

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > this.clientTimeout) {
        logger.info({ clientId }, "Client timeout, disconnecting");
        client.ws.terminate();
        this.clients.delete(clientId);
      } else {
        client.ws.ping();
      }
    }
  }

  /** 关闭服务器 */
  close(): void {
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.wss.close();
    logger.info("WebSocket server closed");
  }
}
