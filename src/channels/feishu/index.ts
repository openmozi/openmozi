/**
 * 飞书通道适配器
 */

import { Router, type Request, type Response } from "express";
import type {
  FeishuConfig,
  ChannelMeta,
  OutboundMessage,
  SendResult,
} from "../../types/index.js";
import { BaseChannelAdapter } from "../common/base.js";
import { FeishuApiClient } from "./api.js";
import {
  FeishuEventHandler,
  type UrlVerificationEvent,
  type MessageReceiveEvent,
} from "./events.js";
import { getChildLogger } from "../../utils/logger.js";

/** 飞书通道元数据 */
const FEISHU_META: ChannelMeta = {
  id: "feishu",
  name: "飞书",
  description: "飞书 (Lark) 企业协作平台",
  capabilities: {
    chatTypes: ["direct", "group"],
    supportsMedia: true,
    supportsReply: true,
    supportsMention: true,
    supportsReaction: true,
    supportsThread: true,
    supportsEdit: false,
    maxMessageLength: 4096,
  },
};

export class FeishuChannel extends BaseChannelAdapter {
  readonly id = "feishu" as const;
  readonly meta = FEISHU_META;

  private config: FeishuConfig;
  private apiClient: FeishuApiClient;
  private eventHandler: FeishuEventHandler;
  private initialized = false;

  constructor(config: FeishuConfig) {
    super();
    this.config = config;
    this.apiClient = new FeishuApiClient(config);
    this.eventHandler = new FeishuEventHandler(config);
    this.logger = getChildLogger("feishu");
  }

  /** 初始化通道 */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.info("Initializing Feishu channel");

    // 验证配置
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu appId and appSecret are required");
    }

    // 测试获取 token
    try {
      await this.apiClient.getTenantAccessToken();
      this.logger.info("Successfully authenticated with Feishu");
    } catch (error) {
      this.logger.error({ error }, "Failed to authenticate with Feishu");
      throw error;
    }

    this.initialized = true;
  }

  /** 关闭通道 */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Feishu channel");
    this.initialized = false;
  }

  /** 发送消息 */
  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      let messageId: string;

      if (message.replyToId) {
        messageId = await this.apiClient.replyText(message.replyToId, message.content);
      } else {
        messageId = await this.apiClient.sendText(message.chatId, message.content);
      }

      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, message }, "Failed to send message");
      return { success: false, error: errorMessage };
    }
  }

  /** 发送文本消息 */
  async sendText(chatId: string, text: string, replyToId?: string): Promise<SendResult> {
    return this.sendMessage({ chatId, content: text, replyToId });
  }

  /** 检查通道状态 */
  async isHealthy(): Promise<boolean> {
    try {
      await this.apiClient.getTenantAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  /** 创建 Express 路由处理器 */
  createRouter(): Router {
    const router = Router();

    router.post("/webhook", (req: Request, res: Response) => {
      this.handleWebhook(req, res).catch((error) => {
        this.logger.error({ error }, "Webhook handler error");
        res.status(500).json({ error: "Internal server error" });
      });
    });

    return router;
  }

  /** 处理 Webhook 请求 */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const { body, headers } = req;

    // 验证签名
    const timestamp = headers["x-lark-request-timestamp"] as string;
    const nonce = headers["x-lark-request-nonce"] as string;
    const signature = headers["x-lark-signature"] as string;

    if (timestamp && nonce && signature) {
      const rawBody = JSON.stringify(body);
      if (!this.eventHandler.verifySignature(timestamp, nonce, rawBody, signature)) {
        this.logger.warn("Invalid signature");
        res.status(403).json({ error: "Invalid signature" });
        return;
      }
    }

    try {
      const { type, data } = this.eventHandler.parseEvent(body);

      switch (type) {
        case "url_verification":
          const challenge = this.eventHandler.handleUrlVerification(data as UrlVerificationEvent);
          res.json(challenge);
          break;

        case "im.message.receive_v1":
          // 立即响应，避免飞书超时
          res.json({ code: 0 });

          // 异步处理消息
          const context = this.eventHandler.convertToMessageContext(data as MessageReceiveEvent);
          if (context) {
            this.handleInboundMessage(context).catch((error) => {
              this.logger.error({ error, context }, "Failed to handle message");
            });
          }
          break;

        default:
          this.logger.debug({ type }, "Ignoring event");
          res.json({ code: 0 });
      }
    } catch (error) {
      this.logger.error({ error }, "Failed to parse event");
      res.status(400).json({ error: "Invalid event" });
    }
  }

  /** 获取 API 客户端 */
  getApiClient(): FeishuApiClient {
    return this.apiClient;
  }
}

/** 创建飞书通道 */
export function createFeishuChannel(config: FeishuConfig): FeishuChannel {
  return new FeishuChannel(config);
}
