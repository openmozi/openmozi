/**
 * 飞书 WebSocket 长连接客户端
 *
 * 使用飞书官方 SDK 实现，支持：
 * - 自动重连
 * - 心跳保活
 * - 消息事件处理
 */

import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, InboundMessageContext } from "../../types/index.js";
import { getChildLogger } from "../../utils/logger.js";
import type { Logger } from "pino";

/** 事件处理器类型 */
export type FeishuWebSocketEventHandler = (context: InboundMessageContext) => void | Promise<void>;

/** 消息事件数据类型 */
interface MessageEventData {
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
}

/** 飞书 WebSocket 客户端 */
export class FeishuWebSocketClient {
  private config: FeishuConfig;
  private logger: Logger;
  private wsClient: lark.WSClient | null = null;
  private eventDispatcher: lark.EventDispatcher | null = null;
  private eventHandler: FeishuWebSocketEventHandler | null = null;
  private connected = false;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.logger = getChildLogger("feishu-ws");
  }

  /** 设置事件处理器 */
  setEventHandler(handler: FeishuWebSocketEventHandler): void {
    this.eventHandler = handler;
  }

  /** 启动连接 */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn("WebSocket already connected");
      return;
    }

    this.logger.info("Starting Feishu WebSocket client with official SDK");

    // 创建事件分发器
    this.eventDispatcher = new lark.EventDispatcher({});

    // 注册消息事件处理
    this.eventDispatcher.register({
      "im.message.receive_v1": async (data: MessageEventData) => {
        await this.handleMessageEvent(data);
      },
    });

    // 创建 WebSocket 客户端
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info,
    });

    // 启动客户端
    await this.wsClient.start({
      eventDispatcher: this.eventDispatcher,
    });

    this.connected = true;
    this.logger.info("Feishu WebSocket client started successfully");
  }

  /** 处理消息事件 */
  private async handleMessageEvent(data: MessageEventData): Promise<void> {
    const message = data.message;
    const sender = data.sender;

    if (!message) {
      this.logger.debug("Received event without message data");
      return;
    }

    this.logger.debug(
      { messageId: message.message_id, chatId: message.chat_id },
      "Processing message event"
    );

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

    // 构建消息上下文
    const context: InboundMessageContext = {
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

    // 调用事件处理器
    if (this.eventHandler) {
      try {
        await Promise.resolve(this.eventHandler(context));
      } catch (error) {
        this.logger.error({ error }, "Event handler error");
      }
    }
  }

  /** 停止客户端 */
  async stop(): Promise<void> {
    this.logger.info("Stopping Feishu WebSocket client");
    this.connected = false;

    // 注意：飞书官方 SDK WSClient 未提供 stop/close API
    // 清空引用以释放事件处理器，SDK 内部连接会随进程退出自动关闭
    if (this.eventDispatcher) {
      this.eventDispatcher = null;
    }
    this.eventHandler = null;
    this.wsClient = null;
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }
}
