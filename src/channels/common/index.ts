/**
 * 通道注册表
 */

import type { ChannelId } from "../../types/index.js";
import type { ChannelAdapter, MessageHandler } from "./base.js";
import { getChildLogger } from "../../utils/logger.js";

export * from "./base.js";

const logger = getChildLogger("channels");

/** 通道注册表 */
const channels = new Map<ChannelId, ChannelAdapter>();

/** 全局消息处理器 */
let globalMessageHandler: MessageHandler | undefined;

/** 注册通道 */
export function registerChannel(channel: ChannelAdapter): void {
  channels.set(channel.id, channel);

  // 如果有全局消息处理器，设置到通道
  if (globalMessageHandler && "setMessageHandler" in channel) {
    (channel as { setMessageHandler: (h: MessageHandler) => void }).setMessageHandler(
      globalMessageHandler
    );
  }

  logger.info({ channel: channel.id }, "Channel registered");
}

/** 获取通道 */
export function getChannel(id: ChannelId): ChannelAdapter | undefined {
  return channels.get(id);
}

/** 获取所有通道 */
export function getAllChannels(): ChannelAdapter[] {
  return Array.from(channels.values());
}

/** 检查通道是否可用 */
export function hasChannel(id: ChannelId): boolean {
  return channels.has(id);
}

/** 设置全局消息处理器 */
export function setGlobalMessageHandler(handler: MessageHandler): void {
  globalMessageHandler = handler;

  // 更新所有已注册通道的处理器
  for (const channel of channels.values()) {
    if ("setMessageHandler" in channel) {
      (channel as { setMessageHandler: (h: MessageHandler) => void }).setMessageHandler(handler);
    }
  }
}

/** 初始化所有通道 */
export async function initializeAllChannels(): Promise<void> {
  for (const channel of channels.values()) {
    try {
      await channel.initialize();
      logger.info({ channel: channel.id }, "Channel initialized");
    } catch (error) {
      logger.error({ channel: channel.id, error }, "Failed to initialize channel");
    }
  }
}

/** 关闭所有通道 */
export async function shutdownAllChannels(): Promise<void> {
  for (const channel of channels.values()) {
    try {
      await channel.shutdown();
      logger.info({ channel: channel.id }, "Channel shut down");
    } catch (error) {
      logger.error({ channel: channel.id, error }, "Failed to shut down channel");
    }
  }
}
