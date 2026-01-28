/**
 * 钉钉 Stream 长连接客户端
 *
 * 参考钉钉官方 SDK 实现，支持：
 * - 自动重连
 * - 心跳保活
 * - 机器人消息回调
 */

import WebSocket from "ws";
import type { DingtalkConfig, InboundMessageContext } from "../../types/index.js";
import { getChildLogger } from "../../utils/logger.js";
import type { Logger } from "pino";

/** 钉钉网关地址 */
const GATEWAY_URL = "https://api.dingtalk.com/v1.0/gateway/connections/open";

/** 消息类型 */
const MessageType = {
  SYSTEM: "SYSTEM",
  EVENT: "EVENT",
  CALLBACK: "CALLBACK",
};

/** 系统消息类型 */
const SystemMessageType = {
  CONNECTED: "CONNECTED",
  REGISTERED: "REGISTERED",
  DISCONNECT: "disconnect",
  KEEPALIVE: "KEEPALIVE",
  PING: "ping",
};

/** 机器人消息主题 */
const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";

/** 下行消息接口 */
interface DownStreamMessage {
  specVersion?: string;
  type: string;
  headers: {
    appId?: string;
    connectionId?: string;
    contentType?: string;
    messageId?: string;
    time?: string;
    topic?: string;
    eventType?: string;
    eventId?: string;
    eventCorpId?: string;
  };
  data?: string;
}

/** 机器人消息接口 */
interface RobotMessage {
  conversationId?: string;
  atUsers?: Array<{
    dingtalkId?: string;
    staffId?: string;
  }>;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  msgId?: string;
  senderNick?: string;
  isAdmin?: boolean;
  senderStaffId?: string;
  sessionWebhookExpiredTime?: number;
  createAt?: number;
  senderCorpId?: string;
  conversationType?: string;
  senderId?: string;
  sessionWebhook?: string;
  text?: {
    content?: string;
  };
  robotCode?: string;
  msgtype?: string;
}

/** 事件处理器类型 */
export type DingtalkStreamEventHandler = (context: InboundMessageContext) => void | Promise<void>;

/** 钉钉 Stream 客户端 */
export class DingtalkStreamClient {
  private config: DingtalkConfig;
  private logger: Logger;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 8000;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;
  private wsUrl = "";
  private isAlive = true;
  private eventHandler: DingtalkStreamEventHandler | null = null;

  constructor(config: DingtalkConfig) {
    this.config = config;
    this.logger = getChildLogger("dingtalk-stream");
  }

  /** 设置事件处理器 */
  setEventHandler(handler: DingtalkStreamEventHandler): void {
    this.eventHandler = handler;
  }

  /** 获取 WebSocket 连接端点 */
  private async getEndpoint(): Promise<string> {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: this.config.appKey,
        clientSecret: this.config.appSecret,
        ua: "mozi/1.0",
        subscriptions: [
          { type: "CALLBACK", topic: TOPIC_ROBOT },
        ],
      }),
    });

    const data = await response.json() as {
      endpoint?: string;
      ticket?: string;
      code?: string;
      message?: string;
    };

    if (!data.endpoint || !data.ticket) {
      throw new Error(`Failed to get endpoint: ${data.message || "Unknown error"}`);
    }

    return `${data.endpoint}?ticket=${data.ticket}`;
  }

  /** 启动连接 */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn("Stream already connected");
      return;
    }

    await this.connect();
  }

  /** 建立连接 */
  private async connect(): Promise<void> {
    try {
      this.wsUrl = await this.getEndpoint();
      this.logger.info({ wsUrl: this.wsUrl.substring(0, 50) + "..." }, "Connecting to DingTalk Stream");

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        this.logger.info("Stream connection established");
        this.connected = true;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.isAlive = true;
        this.startHeartbeat();
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on("close", (code, reason) => {
        this.logger.info({ code, reason: reason.toString() }, "Stream connection closed");
        this.handleDisconnect();
      });

      this.ws.on("error", (error) => {
        this.logger.error({ error }, "Stream error");
      });

      this.ws.on("pong", () => {
        this.isAlive = true;
      });
    } catch (error) {
      this.logger.error({ error }, "Failed to connect to DingTalk Stream");
      this.scheduleReconnect();
    }
  }

  /** 处理接收到的消息 */
  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as DownStreamMessage;
      this.logger.debug({ type: message.type, topic: message.headers?.topic }, "Received message");

      switch (message.type) {
        case MessageType.SYSTEM:
          this.handleSystemMessage(message);
          break;
        case MessageType.EVENT:
          this.handleEventMessage(message);
          break;
        case MessageType.CALLBACK:
          this.handleCallbackMessage(message);
          break;
        default:
          this.logger.debug({ type: message.type }, "Unknown message type");
      }
    } catch (error) {
      this.logger.error({ error, data: data.toString().substring(0, 100) }, "Failed to parse message");
    }
  }

  /** 处理系统消息 */
  private handleSystemMessage(message: DownStreamMessage): void {
    const topic = message.headers?.topic;

    switch (topic) {
      case SystemMessageType.CONNECTED:
        this.logger.info("Connected to DingTalk Stream server");
        break;
      case SystemMessageType.REGISTERED:
        this.logger.info("Registered with DingTalk Stream server");
        break;
      case SystemMessageType.DISCONNECT:
        this.logger.warn("Received disconnect message from server");
        break;
      case SystemMessageType.KEEPALIVE:
        // 服务端心跳，回复确认
        this.sendAck(message);
        break;
      case SystemMessageType.PING:
        // 服务端 ping，回复
        this.sendAck(message);
        break;
      default:
        this.logger.debug({ topic }, "Unknown system message");
    }
  }

  /** 处理事件消息 */
  private handleEventMessage(message: DownStreamMessage): void {
    // 发送确认
    this.sendAck(message, { status: "SUCCESS" });
    this.logger.debug({ eventType: message.headers?.eventType }, "Event message received");
  }

  /** 处理回调消息 (机器人消息) */
  private handleCallbackMessage(message: DownStreamMessage): void {
    const topic = message.headers?.topic;

    if (topic === TOPIC_ROBOT && message.data) {
      try {
        const robotMessage = JSON.parse(message.data) as RobotMessage;
        const context = this.convertToMessageContext(robotMessage);

        if (context && this.eventHandler) {
          Promise.resolve(this.eventHandler(context)).catch((error: Error) => {
            this.logger.error({ error }, "Event handler error");
          });
        }

        // 发送确认
        this.sendAck(message, { status: "SUCCESS" });
      } catch (error) {
        this.logger.error({ error }, "Failed to parse robot message");
        this.sendAck(message, { status: "LATER" });
      }
    } else {
      this.sendAck(message, { status: "SUCCESS" });
    }
  }

  /** 转换为消息上下文 */
  private convertToMessageContext(message: RobotMessage): InboundMessageContext | null {
    if (!message.msgId || !message.conversationId) {
      return null;
    }

    // 提取消息内容
    let content = "";
    if (message.msgtype === "text" && message.text?.content) {
      content = message.text.content.trim();
    }

    return {
      channelId: "dingtalk",
      messageId: message.msgId,
      chatId: message.conversationId,
      chatType: message.conversationType === "1" ? "direct" : "group",
      senderId: message.senderStaffId || message.senderId || "",
      senderName: message.senderNick,
      content,
      timestamp: message.createAt || Date.now(),
      raw: message,
    };
  }

  /** 发送确认消息 */
  private sendAck(message: DownStreamMessage, data?: Record<string, unknown>): void {
    const response = {
      code: 200,
      headers: {
        contentType: "application/json",
        messageId: message.headers?.messageId,
      },
      message: "OK",
      data: data ? JSON.stringify(data) : "",
    };

    this.send(response);
  }

  /** 发送消息 */
  private send(data: unknown): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** 启动心跳 */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.isAlive) {
        this.logger.warn("Heartbeat timeout, terminating connection");
        this.ws?.terminate();
        return;
      }

      this.isAlive = false;
      this.ws?.ping();
    }, this.heartbeatIntervalMs);
  }

  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** 处理断开连接 */
  private handleDisconnect(): void {
    this.connected = false;
    this.stopHeartbeat();

    if (!this.reconnecting) {
      this.scheduleReconnect();
    }
  }

  /** 安排重连 */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("Max reconnect attempts reached, giving up");
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    // 指数退避 + 随机抖动
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      30000
    );

    this.logger.info({ attempt: this.reconnectAttempts, delay }, "Scheduling reconnect");

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /** 停止客户端 */
  async stop(): Promise<void> {
    this.logger.info("Stopping DingTalk Stream client");
    this.reconnecting = false;
    this.maxReconnectAttempts = 0;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }
}
