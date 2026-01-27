/**
 * 上下文压缩和摘要系统
 */

import type { ChatMessage, ProviderId } from "../types/index.js";
import { getProvider, findProviderForModel } from "../providers/index.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("compaction");

/** 默认上下文窗口大小 */
const DEFAULT_CONTEXT_TOKENS = 32000;

/** 基础块比例 */
const BASE_CHUNK_RATIO = 0.4;

/** 最小块比例 */
const MIN_CHUNK_RATIO = 0.15;

/** 安全边际 (估算误差缓冲) */
const SAFETY_MARGIN = 1.2;

/** 默认摘要回退文本 */
const DEFAULT_SUMMARY_FALLBACK = "No prior history.";

// ============== Token 估算 ==============

/**
 * 估算文本的 token 数量
 * 使用简单的字符计数估算 (中文约 1.5 字符/token, 英文约 4 字符/token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 统计中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  // 其他字符
  const otherChars = text.length - chineseChars;

  // 中文约 1.5 字符/token, 英文约 4 字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 估算消息的 token 数量
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let content = "";
  if (typeof message.content === "string") {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    content = message.content
      .map((part) => (part.type === "text" ? part.text : "[image]"))
      .join("");
  } else {
    content = "";
  }

  // 添加角色开销 (约 4 tokens)
  return estimateTokens(content) + 4;
}

/**
 * 估算消息列表的总 token 数量
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ============== 消息分块 ==============

/**
 * 按 token 份额分割消息
 */
export function splitMessagesByTokenShare(
  messages: ChatMessage[],
  parts = 2
): ChatMessage[][] {
  if (messages.length === 0) return [];
  if (parts <= 1 || messages.length < parts) return [messages];

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / parts;

  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateMessageTokens(message);

    if (
      chunks.length < parts - 1 &&
      current.length > 0 &&
      currentTokens + messageTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * 按最大 token 数分块
 */
export function chunkMessagesByMaxTokens(
  messages: ChatMessage[],
  maxTokens: number
): ChatMessage[][] {
  if (messages.length === 0) return [];

  const chunks: ChatMessage[][] = [];
  let currentChunk: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateMessageTokens(message);

    if (currentChunk.length > 0 && currentTokens + messageTokens > maxTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    // 处理超大消息
    if (messageTokens > maxTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * 计算自适应块比例
 */
export function computeAdaptiveChunkRatio(
  messages: ChatMessage[],
  contextWindow: number
): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

// ============== 摘要生成 ==============

/**
 * 摘要生成选项
 */
export interface SummarizeOptions {
  provider?: ProviderId;
  model?: string;
  maxChunkTokens?: number;
  contextWindow?: number;
  customInstructions?: string;
  previousSummary?: string;
}

/**
 * 将消息格式化为摘要输入
 */
function formatMessagesForSummary(messages: ChatMessage[]): string {
  return messages
    .map((msg) => {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("")
            : "";
      return `[${msg.role}]: ${content}`;
    })
    .join("\n\n");
}

/**
 * 生成消息摘要
 */
export async function generateSummary(
  messages: ChatMessage[],
  options: SummarizeOptions
): Promise<string> {
  if (messages.length === 0) {
    return options.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const provider = options.provider
    ? getProvider(options.provider)
    : findProviderForModel(options.model ?? "");

  if (!provider) {
    logger.warn("No provider available for summarization");
    return formatMessagesForSummary(messages).slice(0, 2000) + "...[truncated]";
  }

  const model = options.model ?? provider.getModels()[0]?.id;
  if (!model) {
    return formatMessagesForSummary(messages).slice(0, 2000) + "...[truncated]";
  }

  const systemPrompt = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that preserves:
- Key decisions and conclusions
- Important facts and information
- Open questions or pending items
- Any constraints or requirements mentioned

${options.customInstructions ?? ""}

${options.previousSummary ? `Previous context summary:\n${options.previousSummary}\n\n` : ""}

Provide a clear, structured summary in the same language as the conversation.`;

  const conversationText = formatMessagesForSummary(messages);

  try {
    const response = await provider.chat({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Please summarize this conversation:\n\n${conversationText}` },
      ],
      temperature: 0.3,
      maxTokens: 1000,
    });

    return response.content;
  } catch (error) {
    logger.error({ error }, "Failed to generate summary");
    return formatMessagesForSummary(messages).slice(0, 2000) + "...[truncated]";
  }
}

/**
 * 分块摘要
 */
async function summarizeChunks(
  messages: ChatMessage[],
  options: SummarizeOptions
): Promise<string> {
  if (messages.length === 0) {
    return options.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const maxChunkTokens = options.maxChunkTokens ?? 4000;
  const chunks = chunkMessagesByMaxTokens(messages, maxChunkTokens);

  let summary = options.previousSummary;

  for (const chunk of chunks) {
    summary = await generateSummary(chunk, {
      ...options,
      previousSummary: summary,
    });
  }

  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

/**
 * 带回退的摘要生成
 */
export async function summarizeWithFallback(
  messages: ChatMessage[],
  options: SummarizeOptions
): Promise<string> {
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_TOKENS;

  if (messages.length === 0) {
    return options.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // 尝试完整摘要
  try {
    return await summarizeChunks(messages, options);
  } catch (error) {
    logger.warn({ error }, "Full summarization failed, trying partial");
  }

  // 回退: 只摘要较小的消息
  const smallMessages: ChatMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    const tokens = estimateMessageTokens(msg) * SAFETY_MARGIN;
    if (tokens > contextWindow * 0.5) {
      oversizedNotes.push(
        `[Large ${msg.role} message (~${Math.round(tokens / 1000)}K tokens) omitted]`
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunks(smallMessages, {
        ...options,
        previousSummary: undefined,
      });
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return partialSummary + notes;
    } catch (error) {
      logger.warn({ error }, "Partial summarization also failed");
    }
  }

  // 最终回退
  return `Context contained ${messages.length} messages (${oversizedNotes.length} oversized). Summary unavailable due to size limits.`;
}

/**
 * 多阶段摘要
 */
export async function summarizeInStages(
  messages: ChatMessage[],
  options: SummarizeOptions & {
    parts?: number;
    minMessagesForSplit?: number;
  }
): Promise<string> {
  if (messages.length === 0) {
    return options.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const parts = Math.max(1, options.parts ?? 2);
  const minMessagesForSplit = Math.max(2, options.minMessagesForSplit ?? 4);
  const maxChunkTokens = options.maxChunkTokens ?? 4000;
  const totalTokens = estimateMessagesTokens(messages);

  if (parts <= 1 || messages.length < minMessagesForSplit || totalTokens <= maxChunkTokens) {
    return summarizeWithFallback(messages, options);
  }

  const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0);

  if (splits.length <= 1) {
    return summarizeWithFallback(messages, options);
  }

  // 分别摘要每个部分
  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback(chunk, {
        ...options,
        previousSummary: undefined,
      })
    );
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0]!;
  }

  // 合并摘要
  const summaryMessages: ChatMessage[] = partialSummaries.map((summary) => ({
    role: "user" as const,
    content: summary,
  }));

  const mergeInstructions = options.customInstructions
    ? `Merge these partial summaries into a single cohesive summary. Preserve decisions, TODOs, open questions, and constraints.\n\n${options.customInstructions}`
    : "Merge these partial summaries into a single cohesive summary. Preserve decisions, TODOs, open questions, and constraints.";

  return summarizeWithFallback(summaryMessages, {
    ...options,
    customInstructions: mergeInstructions,
  });
}

// ============== 历史裁剪 ==============

/**
 * 裁剪历史以适应上下文窗口
 */
export function pruneHistoryForContextShare(params: {
  messages: ChatMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;
  parts?: number;
}): {
  messages: ChatMessage[];
  droppedMessages: number;
  droppedTokens: number;
  keptTokens: number;
} {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  const parts = Math.max(1, params.parts ?? 2);

  let keptMessages = params.messages;
  let droppedMessages = 0;
  let droppedTokens = 0;

  while (keptMessages.length > 0 && estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) break;

    const [dropped, ...rest] = chunks;
    droppedMessages += dropped!.length;
    droppedTokens += estimateMessagesTokens(dropped!);
    keptMessages = rest.flat();
  }

  return {
    messages: keptMessages,
    droppedMessages,
    droppedTokens,
    keptTokens: estimateMessagesTokens(keptMessages),
  };
}

/**
 * 限制历史轮次
 */
export function limitHistoryTurns(params: {
  messages: ChatMessage[];
  maxTurns: number;
  preserveSystemMessage?: boolean;
}): ChatMessage[] {
  const { messages, maxTurns, preserveSystemMessage = true } = params;

  if (messages.length === 0 || maxTurns <= 0) return [];

  // 分离系统消息
  const systemMessages = preserveSystemMessage
    ? messages.filter((m) => m.role === "system")
    : [];
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // 计算轮次 (一个用户消息 + 一个助手消息 = 1 轮)
  let turns = 0;
  const keptMessages: ChatMessage[] = [];

  for (let i = nonSystemMessages.length - 1; i >= 0 && turns < maxTurns; i--) {
    const msg = nonSystemMessages[i]!;
    keptMessages.unshift(msg);

    if (msg.role === "user") {
      turns++;
    }
  }

  return [...systemMessages, ...keptMessages];
}
