/**
 * 钉钉通道适配器
 *
 * 支持两种连接模式：
 * - stream: Stream 长连接模式 (默认，无需公网部署)
 * - webhook: 传统 HTTP 回调模式 (需要公网部署)
 */

import { Router, type Request, type Response } from "express";
import type {
  DingtalkConfig,
  ChannelMeta,
  OutboundMessage,
  SendResult,
  InboundMessageContext,
} from "../../types/index.js";
import { BaseChannelAdapter } from "../common/base.js";
import { DingtalkApiClient } from "./api.js";
import { DingtalkEventHandler, type DingtalkCallbackMessage } from "./events.js";
import { DingtalkStreamClient } from "./stream.js";
import { getChildLogger } from "../../utils/logger.js";

/** 钉钉通道元数据 */
const DINGTALK_META: ChannelMeta = {
  id: "dingtalk",
  name: "钉钉",
  description: "钉钉企业协作平台",
  capabilities: {
    chatTypes: ["direct", "group"],
    supportsMedia: true,
    supportsReply: true,
    supportsMention: true,
    supportsReaction: false,
    supportsThread: false,
    supportsEdit: false,
    maxMessageLength: 6000,
  },
};

/** 会话上下文缓存 */
interface SessionContext {
  sessionWebhook: string;
  expireTime: number;
  conversationType: "direct" | "group";
  openConversationId?: string;
}

export class DingtalkChannel extends BaseChannelAdapter {
  readonly id = "dingtalk" as const;
  readonly meta = DINGTALK_META;

  private config: DingtalkConfig;
  private apiClient: DingtalkApiClient;
  private eventHandler: DingtalkEventHandler;
  private streamClient: DingtalkStreamClient | null = null;
  private initialized = false;

  // 缓存会话上下文，用于回复消息
  private sessionCache = new Map<string, SessionContext>();

  constructor(config: DingtalkConfig) {
    super();
    this.config = config;
    this.apiClient = new DingtalkApiClient(config);
    this.eventHandler = new DingtalkEventHandler(config);
    this.logger = getChildLogger("dingtalk");
  }

  /** 初始化通道 */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const mode = this.config.mode || "stream"; // 默认使用长连接
    this.logger.info({ mode }, "Initializing DingTalk channel");

    // 验证配置
    if (!this.config.appKey || !this.config.appSecret) {
      throw new Error("DingTalk appKey and appSecret are required");
    }

    // 测试获取 token
    try {
      await this.apiClient.getAccessToken();
      this.logger.info("Successfully authenticated with DingTalk");
    } catch (error) {
      this.logger.error({ error }, "Failed to authenticate with DingTalk");
      throw error;
    }

    // 如果使用 Stream 模式，启动长连接
    if (mode === "stream") {
      await this.startStream();
    }

    this.initialized = true;
  }

  /** 启动 Stream 连接 */
  private async startStream(): Promise<void> {
    this.logger.info("Starting DingTalk Stream client");
    this.streamClient = new DingtalkStreamClient(this.config);

    // 设置事件处理器
    this.streamClient.setEventHandler(async (context) => {
      // 缓存 sessionWebhook 用于回复
      const extContext = context as InboundMessageContext & { sessionWebhook?: string; sessionWebhookExpiredTime?: number };
      if (extContext.sessionWebhook) {
        this.sessionCache.set(context.chatId, {
          sessionWebhook: extContext.sessionWebhook,
          expireTime: extContext.sessionWebhookExpiredTime || Date.now() + 3600000,
          conversationType: context.chatType === "group" ? "group" : "direct",
          openConversationId: context.chatId,
        });
      }
      await this.handleInboundMessage(context);
    });

    // 启动连接
    await this.streamClient.start();
  }

  /** 关闭通道 */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down DingTalk channel");

    if (this.streamClient) {
      await this.streamClient.stop();
      this.streamClient = null;
    }

    this.sessionCache.clear();
    this.initialized = false;
  }

  /** 发送消息 */
  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      // 优先使用缓存的 session webhook
      const session = this.sessionCache.get(message.chatId);

      if (session && session.expireTime > Date.now()) {
        await this.apiClient.replyWebhookMessage(session.sessionWebhook, message.content);
        return { success: true };
      }

      // 如果没有缓存或已过期，尝试使用机器人消息 API
      if (session?.conversationType === "group" && session.openConversationId) {
        await this.apiClient.sendGroupMessage(session.openConversationId, message.content);
      } else {
        await this.apiClient.sendRobotMessage(message.chatId, message.content);
      }

      return { success: true };
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
      // 检查 API 认证
      await this.apiClient.getAccessToken();

      // 如果使用 Stream 模式，还要检查连接状态
      const mode = this.config.mode || "stream";
      if (mode === "stream" && this.streamClient) {
        return this.streamClient.isConnected();
      }

      return true;
    } catch {
      return false;
    }
  }

  /** 创建 Express 路由处理器 */
  createRouter(): Router {
    const router = Router();

    // Webhook 路由（即使使用 Stream 模式也保留，用于兼容）
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
    const timestamp = headers["timestamp"] as string;
    const sign = headers["sign"] as string;

    if (timestamp && sign) {
      if (!this.eventHandler.verifySignature(timestamp, sign)) {
        this.logger.warn("Invalid signature");
        res.status(403).json({ error: "Invalid signature" });
        return;
      }
    }

    try {
      const message = body as DingtalkCallbackMessage;

      // 立即响应
      res.json({ msgtype: "empty" });

      // 如果使用 Stream 模式，忽略 Webhook 消息（防止重复处理）
      const mode = this.config.mode || "stream";
      if (mode === "stream") {
        this.logger.debug("Ignoring webhook message in Stream mode");
        return;
      }

      // 缓存会话上下文
      if (message.sessionWebhook) {
        this.sessionCache.set(message.senderStaffId || message.openConversationId || "", {
          sessionWebhook: message.sessionWebhook,
          expireTime: message.sessionWebhookExpiredTime || Date.now() + 3600000,
          conversationType: message.conversationType === "2" ? "group" : "direct",
          openConversationId: message.openConversationId,
        });
      }

      // 转换并处理消息
      const context = this.eventHandler.convertToMessageContext(message);
      if (context) {
        // 保存 sessionWebhook 到 raw 用于回复
        if (message.sessionWebhook) {
          (context as InboundMessageContext & { sessionWebhook?: string }).sessionWebhook =
            message.sessionWebhook;
        }

        this.handleInboundMessage(context).catch((error) => {
          this.logger.error({ error, context }, "Failed to handle message");
        });
      }
    } catch (error) {
      this.logger.error({ error }, "Failed to parse message");
    }
  }

  /** 使用 Session Webhook 回复 */
  async replyWithSession(
    context: InboundMessageContext & { sessionWebhook?: string },
    text: string
  ): Promise<SendResult> {
    const sessionWebhook = context.sessionWebhook;

    if (sessionWebhook) {
      try {
        await this.apiClient.replyWebhookMessage(sessionWebhook, text);
        return { success: true };
      } catch (error) {
        this.logger.error({ error }, "Failed to reply with session webhook");
      }
    }

    // 回退到普通发送
    return this.sendText(context.chatId, text);
  }

  /** 获取 API 客户端 */
  getApiClient(): DingtalkApiClient {
    return this.apiClient;
  }

  /** 获取连接模式 */
  getMode(): "stream" | "webhook" {
    return this.config.mode || "stream";
  }

  /** 检查是否使用长连接 */
  isUsingStream(): boolean {
    const mode = this.config.mode || "stream";
    return mode === "stream" && this.streamClient !== null;
  }
}

/** 创建钉钉通道 */
export function createDingtalkChannel(config: DingtalkConfig): DingtalkChannel {
  return new DingtalkChannel(config);
}
