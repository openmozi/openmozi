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
} from "./types.js";
import type { Agent } from "../agents/agent.js";
import type { MoziConfig } from "../types/index.js";
import { getAllProviders } from "../providers/index.js";
import { getAllChannels } from "../channels/index.js";

const logger = getChildLogger("websocket");

/** WebSocket 客户端 */
interface WsClient {
  id: string;
  ws: WebSocket;
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
  private handleConnection(ws: WebSocket): void {
    const clientId = generateId("client");
    const sessionId = generateId("session");

    const client: WsClient = {
      id: clientId,
      ws,
      sessionId,
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);
    logger.info({ clientId, sessionId }, "Client connected");

    // 发送欢迎消息
    this.sendEvent(ws, "connected", {
      clientId,
      sessionId,
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

    logger.debug({ clientId: client.id, message: message.slice(0, 100) }, "Chat send");

    // 构造消息上下文
    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionId,
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
  private async handleChatClear(client: WsClient): Promise<{ success: boolean }> {
    const context = {
      channelId: "webchat" as const,
      chatId: client.sessionId,
      messageId: generateId("msg"),
      senderId: client.id,
      senderName: "WebChat User",
      content: "",
      chatType: "direct" as const,
      timestamp: Date.now(),
    };

    this.agent.clearSession(context);

    // 生成新的会话 ID
    client.sessionId = generateId("session");

    return { success: true };
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
      chatId: client.sessionId,
      messageId: "",
      senderId: client.id,
      senderName: "",
      content: "",
      chatType: "direct" as const,
      timestamp: Date.now(),
    };

    const info = this.agent.getSessionInfo(context);
    return {
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
