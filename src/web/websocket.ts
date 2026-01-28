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
  sessionKey: string;
  sessionId: string;
  lastPing: number;
}

/** WebSocket 服务选项 */
export interface WsServerOptions {
  server: HttpServer;
  agent: Agent;
  config: MoziConfig;
}

/** WebSocket 服务器类 */
export class WsServer {
  private wss: WebSocketServer;
  private clients = new Map<string, WsClient>();
  private agent: Agent;
  private config: MoziConfig;
  private startTime = Date.now();

  constructor(options: WsServerOptions) {
    this.agent = options.agent;
    this.config = options.config;

    this.wss = new WebSocketServer({
      server: options.server,
      path: "/ws",
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws);
    });

    // 心跳检测
    setInterval(() => this.checkHeartbeat(), 30000);

    logger.info("WebSocket server initialized");
  }

  /** 处理新连接 */
  private async handleConnection(ws: WebSocket): Promise<void> {
    const clientId = generateId("client");
    const sessionKey = `webchat:${clientId}`;

    // 从会话存储获取或创建会话
    const store = getSessionStore();
    const session = await store.getOrCreate(sessionKey);

    const client: WsClient = {
      id: clientId,
      ws,
      sessionKey,
      sessionId: session.sessionId,
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);
    logger.info({ clientId, sessionKey, sessionId: session.sessionId }, "Client connected");

    // 发送欢迎消息
    this.sendEvent(ws, "connected", {
      clientId,
      sessionKey,
      sessionId: session.sessionId,
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

  /** 处理聊天发送 */
  private async handleChatSend(
    client: WsClient,
    params: ChatSendParams
  ): Promise<{ messageId: string }> {
    const { message } = params;
    const messageId = generateId("msg");
    const store = getSessionStore();

    logger.debug({ clientId: client.id, message: message.slice(0, 100) }, "Chat send");

    // 保存用户消息到 transcript
    const userMessage: TranscriptMessage = {
      id: messageId,
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    await store.appendTranscript(client.sessionId, client.sessionKey, userMessage);

    // 构造消息上下文
    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionKey,
      messageId,
      senderId: client.id,
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
      await store.appendTranscript(client.sessionId, client.sessionKey, assistantMessage);

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
    const store = getSessionStore();

    // 重置会话
    const newSession = await store.reset(client.sessionKey);

    // 更新客户端会话 ID
    client.sessionId = newSession.sessionId;

    // 清除 Agent 中的会话
    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionKey,
      messageId: generateId("msg"),
      senderId: client.id,
      senderName: "WebChat User",
      content: "",
      chatType: "direct" as const,
      timestamp: Date.now(),
    };

    this.agent.clearSession(context);

    return {
      success: true,
      sessionKey: client.sessionKey,
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
      chatId: client.sessionKey,
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
    const timeout = 60000; // 60 秒超时

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > timeout) {
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
