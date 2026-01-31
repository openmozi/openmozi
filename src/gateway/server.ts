/**
 * Gateway 服务器 - HTTP Webhook 处理 + WebChat
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server as HttpServer } from "http";
import type { MoziConfig, InboundMessageContext } from "../types/index.js";
import { createFeishuChannel, type FeishuChannel } from "../channels/feishu/index.js";
import { createDingtalkChannel, type DingtalkChannel } from "../channels/dingtalk/index.js";
import { createQQChannel, type QQChannel } from "../channels/qq/index.js";
import { createWeComChannel, type WeComChannel } from "../channels/wecom/index.js";
import { registerChannel } from "../channels/common/index.js";
import { createAgent, type Agent } from "../agents/agent.js";
import { initializeProviders } from "../providers/index.js";
import { getChildLogger, setLogger, createLogger } from "../utils/logger.js";
import { WsServer } from "../web/websocket.js";
import { handleStaticRequest } from "../web/static.js";

const logger = getChildLogger("gateway");

export class Gateway {
  private app: Express;
  private httpServer: HttpServer;
  private config: MoziConfig;
  private agent!: Agent;
  private feishuChannel?: FeishuChannel;
  private dingtalkChannel?: DingtalkChannel;
  private qqChannel?: QQChannel;
  private wecomChannel?: WeComChannel;
  private wsServer?: WsServer;
  /** 已处理的消息 ID 缓存（用于去重） */
  private processedMessages = new Map<string, number>();
  /** 消息缓存过期时间 (5分钟) */
  private readonly MESSAGE_CACHE_TTL = 5 * 60 * 1000;

  constructor(config: MoziConfig) {
    this.config = config;
    this.app = express();
    this.httpServer = createServer(this.app);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /** 初始化 Agent（异步） */
  async initAgent(): Promise<void> {
    this.agent = await createAgent(this.config);
  }

  /** 设置中间件 */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // 请求日志
    this.app.use((req, res, next) => {
      logger.debug({ method: req.method, path: req.path }, "Incoming request");
      next();
    });
  }

  /** 设置路由 */
  private setupRoutes(): void {
    // 健康检查
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // 飞书 (WebSocket 长连接)
    if (this.config.channels.feishu) {
      this.feishuChannel = createFeishuChannel(this.config.channels.feishu);
      this.feishuChannel.setMessageHandler(this.handleMessage.bind(this));
      this.app.use("/feishu", this.feishuChannel.createRouter());
      registerChannel(this.feishuChannel);
      logger.info("Feishu channel enabled (WebSocket mode)");
    }

    // 钉钉 (Stream 长连接)
    if (this.config.channels.dingtalk) {
      this.dingtalkChannel = createDingtalkChannel(this.config.channels.dingtalk);
      this.dingtalkChannel.setMessageHandler(this.handleMessage.bind(this));
      this.app.use("/dingtalk", this.dingtalkChannel.createRouter());
      registerChannel(this.dingtalkChannel);
      logger.info("DingTalk channel enabled (Stream mode)");
    }

    // QQ 机器人
    if (this.config.channels.qq) {
      this.qqChannel = createQQChannel(this.config.channels.qq);
      this.qqChannel.setMessageHandler(this.handleMessage.bind(this));
      registerChannel(this.qqChannel);
      logger.info("QQ bot enabled (WebSocket mode)");
    }

    // 企业微信
    if (this.config.channels.wecom) {
      this.wecomChannel = createWeComChannel(this.config.channels.wecom);
      this.wecomChannel.setMessageHandler(this.handleMessage.bind(this));
      this.app.use("/wecom", this.wecomChannel.createRouter());
      registerChannel(this.wecomChannel);
      logger.info("WeCom webhook enabled at /wecom/webhook");
    }

    // WebChat 静态文件服务 (放在其他路由之后，作为默认处理)
    this.app.use((req, res, next) => {
      const handled = handleStaticRequest(req, res, { config: this.config });
      if (!handled) {
        next();
      }
    });

    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    // 错误处理
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error({ error: err }, "Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    });
  }

  /** 处理入站消息 */
  private async handleMessage(context: InboundMessageContext): Promise<void> {
    // 消息去重检查
    if (this.isDuplicateMessage(context.messageId)) {
      logger.debug({ messageId: context.messageId }, "Skipping duplicate message");
      return;
    }

    logger.info(
      {
        channel: context.channelId,
        chatId: context.chatId,
        senderId: context.senderId,
        content: context.content.slice(0, 100),
      },
      "Received message"
    );

    // 忽略空消息
    if (!context.content.trim()) {
      return;
    }

    try {
      // 处理消息
      const response = await this.agent.processMessage(context);

      // 发送回复
      await this.sendReply(context, response.content);

      logger.info(
        {
          channel: context.channelId,
          chatId: context.chatId,
          responseLength: response.content.length,
        },
        "Reply sent"
      );
    } catch (error) {
      logger.error({ error, context }, "Failed to process message");

      // 发送错误提示
      await this.sendReply(context, "抱歉，处理您的消息时出现了错误。请稍后重试。");
    }
  }

  /** 发送回复 */
  private async sendReply(context: InboundMessageContext, text: string): Promise<void> {
    switch (context.channelId) {
      case "feishu":
        if (this.feishuChannel) {
          await this.feishuChannel.sendText(context.chatId, text, context.messageId);
        }
        break;

      case "dingtalk":
        if (this.dingtalkChannel) {
          // 尝试使用 session webhook 回复
          const dingtalkContext = context as InboundMessageContext & { sessionWebhook?: string };
          await this.dingtalkChannel.replyWithSession(dingtalkContext, text);
        }
        break;

      case "qq":
        if (this.qqChannel) {
          await this.qqChannel.sendText(context.chatId, text, context.messageId);
        }
        break;

      case "wecom":
        if (this.wecomChannel) {
          await this.wecomChannel.sendText(context.chatId, text);
        }
        break;
    }
  }

  /** 检查是否为重复消息 */
  private isDuplicateMessage(messageId: string): boolean {
    const now = Date.now();

    // 清理过期的消息缓存
    for (const [id, timestamp] of this.processedMessages) {
      if (now - timestamp > this.MESSAGE_CACHE_TTL) {
        this.processedMessages.delete(id);
      }
    }

    // 检查消息是否已处理
    if (this.processedMessages.has(messageId)) {
      return true;
    }

    // 标记为已处理
    this.processedMessages.set(messageId, now);
    return false;
  }

  /** 初始化 */
  async initialize(): Promise<void> {
    logger.info("Initializing gateway...");

    // 初始化模型提供商
    initializeProviders(this.config);

    // 初始化 WebSocket 服务器
    this.wsServer = new WsServer({
      server: this.httpServer,
      agent: this.agent,
      config: this.config,
    });

    // 初始化通道
    if (this.feishuChannel) {
      await this.feishuChannel.initialize();
    }
    if (this.dingtalkChannel) {
      await this.dingtalkChannel.initialize();
    }
    if (this.qqChannel) {
      await this.qqChannel.initialize();
    }
    if (this.wecomChannel) {
      await this.wecomChannel.initialize();
    }

    logger.info("Gateway initialized");
  }

  /** 启动服务器 */
  async start(): Promise<void> {
    await this.initialize();

    const { port, host } = this.config.server;

    this.httpServer.listen(port, host || "0.0.0.0", () => {
      logger.info({ port, host: host || "0.0.0.0" }, "Gateway server started");
      console.log(`\n🚀 Mozi Gateway 已启动`);
      console.log(`   地址: http://${host || "localhost"}:${port}`);
      console.log(`   WebChat: http://${host || "localhost"}:${port}/`);
      console.log(`   控制台: http://${host || "localhost"}:${port}/control`);
      console.log(`   健康检查: http://${host || "localhost"}:${port}/health`);
      if (this.feishuChannel) {
        console.log(`   飞书: WebSocket 长连接已启动`);
      }
      if (this.dingtalkChannel) {
        console.log(`   钉钉: Stream 长连接已启动`);
      }
      if (this.qqChannel) {
        console.log(`   QQ 机器人: WebSocket 长连接已启动`);
      }
      if (this.wecomChannel) {
        console.log(`   企业微信 Webhook: http://${host || "localhost"}:${port}/wecom/webhook`);
      }
      console.log("");
    });
  }

  /** 关闭 */
  async shutdown(): Promise<void> {
    logger.info("Shutting down gateway...");

    if (this.wsServer) {
      this.wsServer.close();
    }

    if (this.feishuChannel) {
      await this.feishuChannel.shutdown();
    }
    if (this.dingtalkChannel) {
      await this.dingtalkChannel.shutdown();
    }
    if (this.qqChannel) {
      await this.qqChannel.shutdown();
    }
    if (this.wecomChannel) {
      await this.wecomChannel.shutdown();
    }

    this.httpServer.close();

    logger.info("Gateway shut down");
  }

  /** 获取 Express 应用 */
  getApp(): Express {
    return this.app;
  }
}

/** 创建 Gateway */
export async function createGateway(config: MoziConfig): Promise<Gateway> {
  const gateway = new Gateway(config);
  await gateway.initAgent();
  return gateway;
}

/** 启动 Gateway 服务器 */
export async function startGateway(config: MoziConfig): Promise<Gateway> {
  // 设置日志
  setLogger(createLogger({ level: config.logging.level }));

  const gateway = await createGateway(config);
  await gateway.start();

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n收到 SIGINT 信号，正在关闭...");
    await gateway.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n收到 SIGTERM 信号，正在关闭...");
    await gateway.shutdown();
    process.exit(0);
  });

  return gateway;
}
