/**
 * 飞书 WebSocket 长连接客户端
 *
 * 参考飞书官方 SDK 实现，支持：
 * - 自动重连
 * - 心跳保活
 * - 消息分片合并
 */

import WebSocket from "ws";
import type { FeishuConfig, InboundMessageContext } from "../../types/index.js";
import { getChildLogger } from "../../utils/logger.js";
import type { Logger } from "pino";

/** WebSocket 端点路径 */
const WS_ENDPOINT_PATH = "/callback/ws/endpoint";

/** 飞书 API 基础地址 */
const FEISHU_DOMAIN = "https://open.feishu.cn";

/** 错误码 */
const ErrorCodes = {
  OK: 0,
  SYSTEM_BUSY: 1,
  FORBIDDEN: 403,
  AUTH_FAILED: 514,
  INTERNAL_ERROR: 1000040343,
  NO_CREDENTIAL: 1000040344,
  EXCEED_CONN_LIMIT: 1000040350,
};

/** 帧类型 */
const FrameType = {
  CONTROL: 0,
  DATA: 1,
};

/** 服务类型 */
const ServiceType = {
  PING: 0,
  PONG: 1,
};

/** 消息类型 */
const MessageType = {
  EVENT: "event",
  CARD: "card",
};

/** 消息帧接口 */
interface Frame {
  method: number;
  service?: number;
  headers: Record<string, string>;
  payload?: string;
}

/** 事件数据接口 */
interface EventData {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          union_id?: string;
          user_id?: string;
          open_id?: string;
        };
        name: string;
      }>;
    };
  };
}

/** 事件处理器类型 */
export type FeishuWebSocketEventHandler = (context: InboundMessageContext) => void | Promise<void>;

/** 飞书 WebSocket 客户端 */
export class FeishuWebSocketClient {
  private config: FeishuConfig;
  private logger: Logger;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingIntervalMs = 120000; // 默认 2 分钟
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;
  private deviceId: string;
  private serviceId = 0;
  private connectionId = "";
  private accessToken = "";
  private messageBuffer: Map<string, { parts: string[]; total: number }> = new Map();
  private eventHandler: FeishuWebSocketEventHandler | null = null;
  private processedEventIds: Set<string> = new Set();
  private maxProcessedEventIds = 10000;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.logger = getChildLogger("feishu-ws");
    this.deviceId = this.generateDeviceId();
  }

  /** 生成设备 ID */
  private generateDeviceId(): string {
    return `mozi-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /** 设置事件处理器 */
  setEventHandler(handler: FeishuWebSocketEventHandler): void {
    this.eventHandler = handler;
  }

  /** 获取 Tenant Access Token */
  private async getTenantAccessToken(): Promise<string> {
    const url = `${FEISHU_DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await response.json() as { code: number; msg: string; tenant_access_token?: string };
    if (data.code !== 0) {
      throw new Error(`Failed to get tenant access token: ${data.msg}`);
    }

    return data.tenant_access_token!;
  }

  /** 获取 WebSocket 连接端点 */
  private async getWebSocketEndpoint(): Promise<string> {
    this.accessToken = await this.getTenantAccessToken();

    const url = `${FEISHU_DOMAIN}/open-apis${WS_ENDPOINT_PATH}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        device_id: this.deviceId,
        app_id: this.config.appId,
      }),
    });

    const data = await response.json() as {
      code: number;
      msg: string;
      data?: {
        url: string;
        client_config?: {
          reconnect_count?: number;
          reconnect_interval?: number;
          reconnect_nonce?: number;
          ping_interval?: number;
        };
      };
    };

    if (data.code !== ErrorCodes.OK) {
      throw new Error(`Failed to get WebSocket endpoint: ${data.msg} (code: ${data.code})`);
    }

    // 更新配置
    if (data.data?.client_config) {
      const clientConfig = data.data.client_config;
      if (clientConfig.ping_interval) {
        this.pingIntervalMs = clientConfig.ping_interval * 1000;
      }
      if (clientConfig.reconnect_count) {
        this.maxReconnectAttempts = clientConfig.reconnect_count;
      }
    }

    return data.data!.url;
  }

  /** 启动连接 */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn("WebSocket already connected");
      return;
    }

    await this.connect();
  }

  /** 建立连接 */
  private async connect(): Promise<void> {
    try {
      const wsUrl = await this.getWebSocketEndpoint();
      this.logger.info({ wsUrl: wsUrl.substring(0, 50) + "..." }, "Connecting to Feishu WebSocket");

      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.logger.info("WebSocket connection established");
        this.connected = true;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on("close", (code, reason) => {
        this.logger.info({ code, reason: reason.toString() }, "WebSocket connection closed");
        this.handleDisconnect();
      });

      this.ws.on("error", (error) => {
        this.logger.error({ error }, "WebSocket error");
      });
    } catch (error) {
      this.logger.error({ error }, "Failed to connect to Feishu WebSocket");
      this.scheduleReconnect();
    }
  }

  /** 处理接收到的消息 */
  private handleMessage(data: Buffer): void {
    try {
      // 尝试解析为 JSON (简化实现，实际飞书使用 protobuf)
      const message = JSON.parse(data.toString()) as Frame;
      this.logger.debug({ method: message.method, headers: message.headers }, "Received frame");

      if (message.method === FrameType.CONTROL) {
        this.handleControlFrame(message);
      } else if (message.method === FrameType.DATA) {
        this.handleDataFrame(message);
      }
    } catch (error) {
      // 如果不是 JSON，尝试按二进制格式解析
      this.handleBinaryMessage(data);
    }
  }

  /** 处理二进制消息 (简化实现) */
  private handleBinaryMessage(data: Buffer): void {
    try {
      // 尝试作为 UTF-8 字符串解析
      const text = data.toString("utf-8");
      if (text.startsWith("{")) {
        const json = JSON.parse(text);
        this.processEventData(json);
      }
    } catch {
      this.logger.debug({ dataLength: data.length }, "Received binary message");
    }
  }

  /** 处理控制帧 */
  private handleControlFrame(frame: Frame): void {
    const status = frame.headers?.["handshake-status"];

    if (status) {
      const statusCode = parseInt(status, 10);
      if (statusCode === ErrorCodes.OK) {
        this.logger.info("Handshake successful");
        this.connectionId = frame.headers?.["connection-id"] || "";
        this.serviceId = parseInt(frame.headers?.["service-id"] || "0", 10);
        this.startPingLoop();
      } else {
        this.logger.error({ status, msg: frame.headers?.["handshake-msg"] }, "Handshake failed");
        this.ws?.close();
      }
      return;
    }

    // 处理 PING
    if (frame.service === ServiceType.PING) {
      this.sendPong();
    }
  }

  /** 处理数据帧 */
  private handleDataFrame(frame: Frame): void {
    const messageType = frame.headers?.["type"];
    const messageId = frame.headers?.["message_id"];
    const sum = parseInt(frame.headers?.["sum"] || "1", 10);
    const seq = parseInt(frame.headers?.["seq"] || "0", 10);

    // 处理分片消息
    if (sum > 1 && messageId) {
      const combined = this.combineMessage(messageId, frame.payload || "", sum, seq);
      if (combined) {
        this.processPayload(messageType, combined, messageId);
      }
    } else {
      this.processPayload(messageType, frame.payload || "", messageId || "");
    }
  }

  /** 合并分片消息 */
  private combineMessage(messageId: string, payload: string, total: number, seq: number): string | null {
    let buffer = this.messageBuffer.get(messageId);
    if (!buffer) {
      buffer = { parts: new Array(total), total };
      this.messageBuffer.set(messageId, buffer);
    }

    buffer.parts[seq] = payload;

    // 检查是否所有分片都已收到
    const received = buffer.parts.filter(Boolean).length;
    if (received === total) {
      this.messageBuffer.delete(messageId);
      return buffer.parts.join("");
    }

    return null;
  }

  /** 处理消息负载 */
  private processPayload(type: string | undefined, payload: string, messageId: string): void {
    try {
      const data = JSON.parse(payload);
      this.processEventData(data, messageId);
    } catch (error) {
      this.logger.error({ error, payload: payload.substring(0, 100) }, "Failed to parse payload");
    }
  }

  /** 处理事件数据 */
  private processEventData(data: EventData, messageId?: string): void {
    // 事件去重
    const eventId = data.header?.event_id;
    if (eventId) {
      if (this.processedEventIds.has(eventId)) {
        this.logger.debug({ eventId }, "Duplicate event, ignoring");
        return;
      }
      this.processedEventIds.add(eventId);
      if (this.processedEventIds.size > this.maxProcessedEventIds) {
        const first = this.processedEventIds.values().next().value;
        if (first) this.processedEventIds.delete(first);
      }
    }

    const eventType = data.header?.event_type;
    this.logger.debug({ eventType, eventId }, "Processing event");

    // 处理消息事件
    if (eventType === "im.message.receive_v1" && data.event?.message) {
      const context = this.convertToMessageContext(data);
      if (context && this.eventHandler) {
        Promise.resolve(this.eventHandler(context)).catch((error: Error) => {
          this.logger.error({ error }, "Event handler error");
        });
      }
    }

    // 发送确认
    if (messageId) {
      this.sendAck(messageId);
    }
  }

  /** 转换为消息上下文 */
  private convertToMessageContext(data: EventData): InboundMessageContext | null {
    const message = data.event?.message;
    const sender = data.event?.sender;

    if (!message) return null;

    // 解析消息内容
    let content = "";
    try {
      const contentObj = JSON.parse(message.content);
      if (message.message_type === "text") {
        content = contentObj.text || "";
      } else {
        content = `[${message.message_type}]`;
      }
    } catch {
      content = message.content;
    }

    // 移除 @机器人 的内容
    if (message.mentions) {
      for (const mention of message.mentions) {
        content = content.replace(mention.key, "").trim();
      }
    }

    return {
      channelId: "feishu",
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type === "p2p" ? "direct" : "group",
      senderId: sender?.sender_id?.open_id || sender?.sender_id?.user_id || "",
      senderName: undefined,
      content,
      replyToId: message.parent_id,
      timestamp: parseInt(message.create_time, 10),
      raw: data,
    };
  }

  /** 发送 PONG */
  private sendPong(): void {
    const frame: Frame = {
      method: FrameType.CONTROL,
      service: ServiceType.PONG,
      headers: {},
    };
    this.sendFrame(frame);
  }

  /** 发送确认 */
  private sendAck(messageId: string): void {
    const frame: Frame = {
      method: FrameType.DATA,
      headers: {
        "message_id": messageId,
        "type": "ack",
      },
    };
    this.sendFrame(frame);
  }

  /** 发送帧 */
  private sendFrame(frame: Frame): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  /** 启动心跳循环 */
  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      if (this.connected) {
        const frame: Frame = {
          method: FrameType.CONTROL,
          service: ServiceType.PING,
          headers: {},
        };
        this.sendFrame(frame);
      }
    }, this.pingIntervalMs);
  }

  /** 停止心跳循环 */
  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /** 处理断开连接 */
  private handleDisconnect(): void {
    this.connected = false;
    this.stopPingLoop();

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
    this.logger.info("Stopping Feishu WebSocket client");
    this.reconnecting = false;
    this.maxReconnectAttempts = 0; // 阻止重连
    this.stopPingLoop();

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
