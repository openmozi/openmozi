/**
 * 钉钉 API 客户端
 */

import type { DingtalkConfig } from "../../types/index.js";
import { getChildLogger } from "../../utils/logger.js";
import { retry, computeHmacSha256 } from "../../utils/index.js";
import NodeCache from "node-cache";

const logger = getChildLogger("dingtalk-api");

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const DINGTALK_OLD_API_BASE = "https://oapi.dingtalk.com";

/** Token 缓存 */
const tokenCache = new NodeCache({ stdTTL: 7000 }); // token 有效期 2 小时

/** 钉钉 API 响应基础结构 */
interface DingtalkApiResponse<T = unknown> {
  errcode?: number;
  errmsg?: string;
  success?: boolean;
  result?: T;
  access_token?: string;
  expires_in?: number;
}

/** 消息发送响应 */
interface SendMessageResponse {
  processQueryKey?: string;
  invalidUserId?: string[];
  flowControlledUserId?: string[];
}

/** 钉钉 API 客户端 */
export class DingtalkApiClient {
  private config: DingtalkConfig;

  constructor(config: DingtalkConfig) {
    this.config = config;
  }

  /** 获取 Access Token */
  async getAccessToken(): Promise<string> {
    const cacheKey = `dingtalk_token_${this.config.appKey}`;
    const cached = tokenCache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug("Fetching new access token");

    const response = await fetch(
      `${DINGTALK_OLD_API_BASE}/gettoken?appkey=${this.config.appKey}&appsecret=${this.config.appSecret}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.status}`);
    }

    const data = (await response.json()) as DingtalkApiResponse;

    if (data.errcode !== 0) {
      throw new Error(`DingTalk API Error [${data.errcode}]: ${data.errmsg}`);
    }

    if (!data.access_token) {
      throw new Error("No access token in response");
    }

    // 缓存 token
    tokenCache.set(cacheKey, data.access_token);

    return data.access_token;
  }

  /** 发送请求 (新版 API) */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    useOldApi = false
  ): Promise<T> {
    const token = await this.getAccessToken();
    const baseUrl = useOldApi ? DINGTALK_OLD_API_BASE : DINGTALK_API_BASE;

    const response = await retry(
      async () => {
        const url = useOldApi
          ? `${baseUrl}${path}?access_token=${token}`
          : `${baseUrl}${path}`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (!useOldApi) {
          headers["x-acs-dingtalk-access-token"] = token;
        }

        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        return res;
      },
      { maxRetries: 3, delayMs: 1000 }
    );

    const data = (await response.json()) as DingtalkApiResponse<T>;

    // 旧版 API 错误处理
    if (useOldApi && data.errcode !== undefined && data.errcode !== 0) {
      throw new Error(`DingTalk API Error [${data.errcode}]: ${data.errmsg}`);
    }

    // 新版 API 错误处理
    if (!useOldApi && data.success === false) {
      throw new Error(`DingTalk API Error: ${data.errmsg || "Unknown error"}`);
    }

    return (data.result ?? data) as T;
  }

  /** 发送工作通知消息 */
  async sendWorkNotification(
    userId: string,
    content: unknown
  ): Promise<void> {
    logger.debug({ userId }, "Sending work notification");

    await this.request(
      "POST",
      "/topapi/message/corpconversation/asyncsend_v2",
      {
        agent_id: this.config.robotCode,
        userid_list: userId,
        msg: content,
      },
      true
    );
  }

  /** 机器人发送单聊消息 */
  async sendRobotMessage(
    userId: string,
    content: string
  ): Promise<void> {
    logger.debug({ userId }, "Sending robot message");

    await this.request(
      "POST",
      `/v1.0/robot/oToMessages/batchSend`,
      {
        robotCode: this.config.robotCode,
        userIds: [userId],
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content }),
      }
    );
  }

  /** 机器人发送群消息 */
  async sendGroupMessage(
    openConversationId: string,
    content: string
  ): Promise<void> {
    logger.debug({ openConversationId }, "Sending group message");

    await this.request(
      "POST",
      `/v1.0/robot/groupMessages/send`,
      {
        robotCode: this.config.robotCode,
        openConversationId,
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content }),
      }
    );
  }

  /** 回复 Webhook 消息 */
  async replyWebhookMessage(
    sessionWebhook: string,
    content: string
  ): Promise<void> {
    logger.debug({ sessionWebhook }, "Replying via webhook");

    const response = await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to reply: ${response.status}`);
    }
  }

  /** 发送 Markdown 消息 */
  async sendMarkdownMessage(
    sessionWebhook: string,
    title: string,
    text: string
  ): Promise<void> {
    const response = await fetch(sessionWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { title, text },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send markdown: ${response.status}`);
    }
  }

  /** 获取用户信息 */
  async getUserInfo(userId: string): Promise<unknown> {
    return this.request(
      "POST",
      "/topapi/v2/user/get",
      { userid: userId },
      true
    );
  }

  /** 获取群信息 */
  async getChatInfo(openConversationId: string): Promise<unknown> {
    return this.request(
      "GET",
      `/v1.0/im/conversations/${openConversationId}`
    );
  }
}

/** 验证钉钉回调签名 */
export function verifyDingtalkSignature(
  timestamp: string,
  sign: string,
  appSecret: string
): boolean {
  const stringToSign = timestamp + "\n" + appSecret;
  const expectedSign = computeHmacSha256(appSecret, stringToSign);
  return sign === expectedSign;
}
