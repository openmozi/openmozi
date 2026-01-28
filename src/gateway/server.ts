/**
 * Gateway 服务器 - HTTP Webhook 处理 + WebChat
 */

import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server as HttpServer } from "http";
import type { MoziConfig, InboundMessageContext } from "../types/index.js";
import { createFeishuChannel, type FeishuChannel } from "../channels/feishu/index.js";
import { createDingtalkChannel, type DingtalkChannel } from "../channels/dingtalk/index.js";
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
  private agent: Agent;
  private feishuChannel?: FeishuChannel;
  private dingtalkChannel?: DingtalkChannel;
  private wsServer?: WsServer;

  constructor(config: MoziConfig) {
    this.config = config;
    this.app = express();
    this.httpServer = createServer(this.app);
    this.agent = createAgent(config);

    this.setupMiddleware();
    this.setupRoutes();
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

    // 飞书 Webhook
    if (this.config.channels.feishu) {
      this.feishuChannel = createFeishuChannel(this.config.channels.feishu);
      this.feishuChannel.setMessageHandler(this.handleMessage.bind(this));
      this.app.use("/feishu", this.feishuChannel.createRouter());
      registerChannel(this.feishuChannel);
      logger.info("Feishu webhook enabled at /feishu/webhook");
    }

    // 钉钉 Webhook
    if (this.config.channels.dingtalk) {
      this.dingtalkChannel = createDingtalkChannel(this.config.channels.dingtalk);
      this.dingtalkChannel.setMessageHandler(this.handleMessage.bind(this));
      this.app.use("/dingtalk", this.dingtalkChannel.createRouter());
      registerChannel(this.dingtalkChannel);
      logger.info("DingTalk webhook enabled at /dingtalk/webhook");
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
    this.app.use((err: Error, req: Request, res: Response, next: Function) => {
      logger.error({ error: err }, "Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    });
  }

  /** 处理入站消息 */
  private async handleMessage(context: InboundMessageContext): Promise<void> {
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
    }
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
        console.log(`   飞书 Webhook: http://${host || "localhost"}:${port}/feishu/webhook`);
      }
      if (this.dingtalkChannel) {
        console.log(`   钉钉 Webhook: http://${host || "localhost"}:${port}/dingtalk/webhook`);
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

    this.httpServer.close();

    logger.info("Gateway shut down");
  }

  /** 获取 Express 应用 */
  getApp(): Express {
    return this.app;
  }
}

/** 创建 Gateway */
export function createGateway(config: MoziConfig): Gateway {
  return new Gateway(config);
}

/** 启动 Gateway 服务器 */
export async function startGateway(config: MoziConfig): Promise<Gateway> {
  // 设置日志
  setLogger(createLogger({ level: config.logging.level }));

  const gateway = createGateway(config);
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
