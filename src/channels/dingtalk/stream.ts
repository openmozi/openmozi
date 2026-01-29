/**
 * 钉钉 Stream 长连接客户端
 *
 * 使用钉钉官方 SDK 实现，支持：
 * - 自动重连
 * - 心跳保活
 * - 机器人消息回调
 */

import {
  DWClient,
  DWClientDownStream,
  EventAck,
  TOPIC_ROBOT,
  type RobotMessage,
} from "dingtalk-stream";
import type { DingtalkConfig, InboundMessageContext } from "../../types/index.js";
import { getChildLogger } from "../../utils/logger.js";
import type { Logger } from "pino";

/** 事件处理器类型 */
export type DingtalkStreamEventHandler = (context: InboundMessageContext) => void | Promise<void>;

/** 钉钉 Stream 客户端 */
export class DingtalkStreamClient {
  private config: DingtalkConfig;
  private logger: Logger;
  private client: DWClient | null = null;
  private eventHandler: DingtalkStreamEventHandler | null = null;
  private connected = false;

  constructor(config: DingtalkConfig) {
    this.config = config;
    this.logger = getChildLogger("dingtalk-stream");
  }

  /** 设置事件处理器 */
  setEventHandler(handler: DingtalkStreamEventHandler): void {
    this.eventHandler = handler;
  }

  /** 启动连接 */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn("Stream already connected");
      return;
    }

    this.logger.info("Starting DingTalk Stream client with official SDK");

    // 创建客户端
    this.client = new DWClient({
      clientId: this.config.appKey,
      clientSecret: this.config.appSecret,
      ua: "mozi/1.0",
      debug: false,
    });

    // 注册机器人消息回调
    this.client.registerCallbackListener(TOPIC_ROBOT, (message: DWClientDownStream) => {
      this.handleRobotMessage(message);
    });

    // 监听连接事件
    this.client.on("connect", () => {
      this.logger.info("DingTalk Stream connected");
      this.connected = true;
    });

    this.client.on("disconnect", () => {
      this.logger.info("DingTalk Stream disconnected");
      this.connected = false;
    });

    this.client.on("error", (error: Error) => {
      this.logger.error({ error }, "DingTalk Stream error");
    });

    // 启动连接
    await this.client.connect();
    this.connected = true;
    this.logger.info("DingTalk Stream client started successfully");
  }

  /** 处理机器人消息 */
  private handleRobotMessage(message: DWClientDownStream): void {
    try {
      const data = JSON.parse(message.data) as RobotMessage;

      this.logger.debug(
        { msgId: data.msgId, conversationId: data.conversationId },
        "Processing robot message"
      );

      // 提取消息内容
      let content = "";
      if (data.msgtype === "text" && data.text?.content) {
        content = data.text.content.trim();
      }

      // 构建消息上下文
      const context: InboundMessageContext & { sessionWebhook?: string; sessionWebhookExpiredTime?: number } = {
        channelId: "dingtalk",
        messageId: data.msgId,
        chatId: data.conversationId,
        chatType: data.conversationType === "1" ? "direct" : "group",
        senderId: data.senderStaffId || data.senderId || "",
        senderName: data.senderNick,
        content,
        timestamp: data.createAt || Date.now(),
        raw: data,
        sessionWebhook: data.sessionWebhook,
        sessionWebhookExpiredTime: data.sessionWebhookExpiredTime,
      };

      // 调用事件处理器
      if (this.eventHandler) {
        Promise.resolve(this.eventHandler(context)).catch((error: Error) => {
          this.logger.error({ error }, "Event handler error");
        });
      }

      // 发送确认响应
      this.client?.socketCallBackResponse(message.headers.messageId, {
        status: EventAck.SUCCESS,
      });
    } catch (error) {
      this.logger.error({ error }, "Failed to process robot message");
      // 返回稍后重试
      this.client?.socketCallBackResponse(message.headers.messageId, {
        status: EventAck.LATER,
      });
    }
  }

  /** 停止客户端 */
  async stop(): Promise<void> {
    this.logger.info("Stopping DingTalk Stream client");

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.connected = false;
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }
}
