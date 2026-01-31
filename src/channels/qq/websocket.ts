/**
 * QQ 机器人 WebSocket 客户端
 * 实现与 QQ 机器人网关的长连接
 */

import WebSocket from "ws";
import { getChildLogger } from "../../utils/logger.js";
import type { QQConfig, InboundMessageContext } from "../../types/index.js";
import { QQApiClient } from "./api.js";

const logger = getChildLogger("qq-ws");

/** WebSocket OpCode */
enum OpCode {
  /** 服务端进行消息推送 */
  Dispatch = 0,
  /** 客户端发送心跳 */
  Heartbeat = 1,
  /** 客户端发送鉴权 */
  Identify = 2,
  /** 客户端恢复连接 */
  Resume = 6,
  /** 服务端通知客户端重新连接 */
  Reconnect = 7,
  /** 当鉴权或重连失败时 */
  InvalidSession = 9,
  /** 服务端返回的 Hello */
  Hello = 10,
  /** 服务端返回的心跳响应 */
  HeartbeatAck = 11,
}

/** WebSocket Payload */
interface WsPayload {
  op: OpCode;
  d?: unknown;
  s?: number;
  t?: string;
}

/** Hello 数据 */
interface HelloData {
  heartbeat_interval: number;
}

/** Ready 数据 */
interface ReadyData {
  session_id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
}

/** 消息事件数据 */
interface MessageEventData {
  id: string;
  author: {
    id: string;
    username?: string;
    member_openid?: string;
    union_openid?: string;
  };
  content: string;
  timestamp: string;
  channel_id?: string;
  guild_id?: string;
  group_openid?: string;
}

/** 事件处理器类型 */
type EventHandler = (context: InboundMessageContext) => Promise<void>;

export class QQWebSocketClient {
  private config: QQConfig;
  private apiClient: QQApiClient;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private botUserId: string | null = null;
  private sequence: number | null = null;
  private heartbeatInterval: number | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private eventHandler: EventHandler | null = null;
  private isConnected = false;

  constructor(config: QQConfig) {
    this.config = config;
    this.apiClient = new QQApiClient(config);
  }

  /** 设置事件处理器 */
  setEventHandler(handler: EventHandler): void {
    this.eventHandler = handler;
  }

  /** 启动连接 */
  async start(): Promise<void> {
    try {
      const gatewayUrl = await this.apiClient.getGatewayUrl();
      logger.info({ gatewayUrl }, "Got gateway URL");
      await this.connect(gatewayUrl);
    } catch (error) {
      logger.error({ error }, "Failed to start WebSocket client");
      throw error;
    }
  }

  /** 连接到网关 */
  private async connect(gatewayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(gatewayUrl);

      this.ws.on("open", () => {
        logger.info("WebSocket connected");
      });

      this.ws.on("message", async (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString()) as WsPayload;
          await this.handlePayload(payload);

          // 在收到 Ready 事件后 resolve
          if (payload.t === "READY") {
            resolve();
          }
        } catch (error) {
          logger.error({ error, data: data.toString() }, "Failed to handle message");
        }
      });

      this.ws.on("close", (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, "WebSocket closed");
        this.isConnected = false;
        this.stopHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on("error", (error) => {
        logger.error({ error }, "WebSocket error");
        reject(error);
      });

      // 设置连接超时
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error("Connection timeout"));
        }
      }, 30000);
    });
  }

  /** 处理 WebSocket 消息 */
  private async handlePayload(payload: WsPayload): Promise<void> {
    // 更新序列号
    if (payload.s !== undefined) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case OpCode.Hello:
        await this.handleHello(payload.d as HelloData);
        break;

      case OpCode.Dispatch:
        await this.handleDispatch(payload.t!, payload.d);
        break;

      case OpCode.HeartbeatAck:
        logger.debug("Heartbeat acknowledged");
        break;

      case OpCode.Reconnect:
        logger.info("Received reconnect request");
        await this.reconnect();
        break;

      case OpCode.InvalidSession:
        logger.warn("Invalid session, re-identifying");
        this.sessionId = null;
        await this.identify();
        break;
    }
  }

  /** 处理 Hello 消息 */
  private async handleHello(data: HelloData): Promise<void> {
    this.heartbeatInterval = data.heartbeat_interval;
    logger.info({ heartbeatInterval: this.heartbeatInterval }, "Received Hello");

    // 开始心跳
    this.startHeartbeat();

    // 发送鉴权
    if (this.sessionId) {
      await this.resume();
    } else {
      await this.identify();
    }
  }

  /** 发送鉴权请求 */
  private async identify(): Promise<void> {
    const token = await this.apiClient.getAccessToken();
    const intents = this.getIntents();

    const payload: WsPayload = {
      op: OpCode.Identify,
      d: {
        token: `QQBot ${token}`,
        intents,
        shard: [0, 1],
        properties: {
          $os: "linux",
          $browser: "mozi",
          $device: "mozi",
        },
      },
    };

    this.send(payload);
    logger.info({ intents }, "Identify sent");
  }

  /** 恢复连接 */
  private async resume(): Promise<void> {
    const token = await this.apiClient.getAccessToken();

    const payload: WsPayload = {
      op: OpCode.Resume,
      d: {
        token: `QQBot ${token}`,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    };

    this.send(payload);
    logger.info("Resume sent");
  }

  /** 获取订阅的事件 intents */
  private getIntents(): number {
    let intents = 0;

    // 基础事件
    intents |= 1 << 0; // GUILDS
    intents |= 1 << 1; // GUILD_MEMBERS
    intents |= 1 << 9; // GUILD_MESSAGE_REACTIONS
    intents |= 1 << 10; // DIRECT_MESSAGE
    intents |= 1 << 12; // INTERACTION
    intents |= 1 << 25; // GROUP_AND_C2C_EVENT (群聊和私聊)
    intents |= 1 << 30; // PUBLIC_GUILD_MESSAGES (公域消息)

    return intents;
  }

  /** 处理事件分发 */
  private async handleDispatch(eventType: string, data: unknown): Promise<void> {
    logger.debug({ eventType }, "Received event");

    switch (eventType) {
      case "READY":
        const readyData = data as ReadyData;
        this.sessionId = readyData.session_id;
        this.botUserId = readyData.user.id;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info({ sessionId: this.sessionId, botUserId: this.botUserId, user: readyData.user }, "Ready");
        break;

      case "RESUMED":
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info("Resumed");
        break;

      // 频道消息
      case "AT_MESSAGE_CREATE":
      case "MESSAGE_CREATE":
        await this.handleChannelMessage(data as MessageEventData);
        break;

      // 私信消息
      case "DIRECT_MESSAGE_CREATE":
        await this.handleDirectMessage(data as MessageEventData);
        break;

      // 群聊消息 (QQ 群)
      case "GROUP_AT_MESSAGE_CREATE":
        await this.handleGroupMessage(data as MessageEventData);
        break;

      // 私聊消息 (QQ 单聊)
      case "C2C_MESSAGE_CREATE":
        await this.handleC2CMessage(data as MessageEventData);
        break;

      default:
        logger.debug({ eventType, data }, "Unhandled event");
    }
  }

  /** 处理频道消息 */
  private async handleChannelMessage(data: MessageEventData): Promise<void> {
    if (!this.eventHandler) return;

    // 过滤机器人自己的消息
    if (this.botUserId && data.author.id === this.botUserId) return;

    const context: InboundMessageContext = {
      channelId: "qq",
      messageId: data.id,
      chatId: data.channel_id!,
      chatType: "group",
      senderId: data.author.id,
      senderName: data.author.username,
      content: this.cleanContent(data.content),
      timestamp: new Date(data.timestamp).getTime(),
      raw: data,
    };

    await this.eventHandler(context);
  }

  /** 处理频道私信 */
  private async handleDirectMessage(data: MessageEventData): Promise<void> {
    if (!this.eventHandler) return;

    const context: InboundMessageContext = {
      channelId: "qq",
      messageId: data.id,
      chatId: data.guild_id!,
      chatType: "direct",
      senderId: data.author.id,
      senderName: data.author.username,
      content: this.cleanContent(data.content),
      timestamp: new Date(data.timestamp).getTime(),
      raw: data,
    };

    await this.eventHandler(context);
  }

  /** 处理 QQ 群消息 */
  private async handleGroupMessage(data: MessageEventData): Promise<void> {
    if (!this.eventHandler) return;

    const context: InboundMessageContext = {
      channelId: "qq",
      messageId: data.id,
      chatId: `group:${data.group_openid}`,
      chatType: "group",
      senderId: data.author.member_openid || data.author.id,
      senderName: data.author.username,
      content: this.cleanContent(data.content),
      timestamp: new Date(data.timestamp).getTime(),
      raw: data,
    };

    await this.eventHandler(context);
  }

  /** 处理 QQ 私聊消息 */
  private async handleC2CMessage(data: MessageEventData): Promise<void> {
    if (!this.eventHandler) return;

    const context: InboundMessageContext = {
      channelId: "qq",
      messageId: data.id,
      chatId: `c2c:${data.author.union_openid || data.author.id}`,
      chatType: "direct",
      senderId: data.author.union_openid || data.author.id,
      senderName: data.author.username,
      content: this.cleanContent(data.content),
      timestamp: new Date(data.timestamp).getTime(),
      raw: data,
    };

    await this.eventHandler(context);
  }

  /** 清理消息内容 (去除 @ 标记等) */
  private cleanContent(content: string): string {
    // 去除 @ 机器人的内容
    return content.replace(/<@!\d+>/g, "").trim();
  }

  /** 开始心跳 */
  private startHeartbeat(): void {
    if (!this.heartbeatInterval) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 发送心跳 */
  private sendHeartbeat(): void {
    const payload: WsPayload = {
      op: OpCode.Heartbeat,
      d: this.sequence,
    };

    this.send(payload);
    logger.debug({ sequence: this.sequence }, "Heartbeat sent");
  }

  /** 发送消息 */
  private send(payload: WsPayload): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** 处理断开连接 */
  private async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);

    logger.info({ attempt: this.reconnectAttempts, delay }, "Reconnecting...");

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.reconnect();
  }

  /** 重新连接 */
  private async reconnect(): Promise<void> {
    try {
      this.stopHeartbeat();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      await this.start();
    } catch (error) {
      logger.error({ error }, "Failed to reconnect");
      await this.handleDisconnect();
    }
  }

  /** 停止连接 */
  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    logger.info("WebSocket client stopped");
  }

  /** 检查是否已连接 */
  checkConnected(): boolean {
    return this.isConnected;
  }
}
