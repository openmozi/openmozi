/**
 * 命令系统 - 斜杠命令处理
 */

import type { InboundMessageContext } from "../types/index.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("commands");

// ============== 命令类型 ==============

/** 命令参数 */
export interface CommandContext {
  /** 原始消息上下文 */
  message: InboundMessageContext;
  /** 命令参数 (去除命令名后的部分) */
  args: string;
  /** 解析后的参数数组 */
  argsArray: string[];
  /** 命名参数 (--key=value 格式) */
  namedArgs: Record<string, string>;
}

/** 命令处理器 */
export type CommandHandler = (
  ctx: CommandContext
) => string | Promise<string>;

/** 命令定义 */
export interface CommandDefinition {
  /** 命令名称 (不含斜杠) */
  name: string;
  /** 命令别名 */
  aliases?: string[];
  /** 命令描述 */
  description: string;
  /** 使用说明 */
  usage?: string;
  /** 处理函数 */
  handler: CommandHandler;
  /** 是否隐藏 (不在帮助中显示) */
  hidden?: boolean;
}

// ============== 命令注册表 ==============

/** 命令注册表 */
const commandRegistry = new Map<string, CommandDefinition>();

/** 注册命令 */
export function registerCommand(command: CommandDefinition): void {
  const normalizedName = command.name.toLowerCase();
  commandRegistry.set(normalizedName, command);

  // 注册别名
  if (command.aliases) {
    for (const alias of command.aliases) {
      commandRegistry.set(alias.toLowerCase(), command);
    }
  }

  logger.debug({ command: command.name }, "Command registered");
}

/** 批量注册命令 */
export function registerCommands(commands: CommandDefinition[]): void {
  for (const command of commands) {
    registerCommand(command);
  }
}

/** 获取命令 */
export function getCommand(name: string): CommandDefinition | undefined {
  return commandRegistry.get(name.toLowerCase());
}

/** 获取所有命令 */
export function getAllCommands(): CommandDefinition[] {
  const uniqueCommands = new Map<string, CommandDefinition>();
  for (const command of commandRegistry.values()) {
    uniqueCommands.set(command.name, command);
  }
  return Array.from(uniqueCommands.values());
}

// ============== 命令解析 ==============

/** 命令前缀 */
const COMMAND_PREFIXES = ["/", "!"];

/** 检查是否为命令 */
export function isCommand(text: string): boolean {
  const trimmed = text.trim();
  return COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** 解析命令 */
export function parseCommand(text: string): {
  name: string;
  args: string;
  argsArray: string[];
  namedArgs: Record<string, string>;
} | null {
  const trimmed = text.trim();

  // 检查前缀
  let content = "";
  for (const prefix of COMMAND_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      content = trimmed.slice(prefix.length);
      break;
    }
  }

  if (!content) return null;

  // 分离命令名和参数
  const spaceIndex = content.indexOf(" ");
  const name = spaceIndex === -1 ? content : content.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? "" : content.slice(spaceIndex + 1).trim();

  // 解析参数
  const argsArray: string[] = [];
  const namedArgs: Record<string, string> = {};

  if (args) {
    // 简单的参数解析 (支持引号)
    const regex = /--(\w+)=("([^"]*)"|'([^']*)'|(\S+))|"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;

    while ((match = regex.exec(args)) !== null) {
      if (match[1]) {
        // 命名参数 --key=value
        const key = match[1];
        const value = match[3] ?? match[4] ?? match[5] ?? "";
        namedArgs[key] = value;
      } else {
        // 位置参数
        const value = match[6] ?? match[7] ?? match[8] ?? "";
        argsArray.push(value);
      }
    }
  }

  return { name: name.toLowerCase(), args, argsArray, namedArgs };
}

// ============== 命令执行 ==============

/** 执行命令 */
export async function executeCommand(
  message: InboundMessageContext
): Promise<string | null> {
  if (!isCommand(message.content)) {
    return null;
  }

  const parsed = parseCommand(message.content);
  if (!parsed) return null;

  const command = getCommand(parsed.name);
  if (!command) {
    return `未知命令: ${parsed.name}\n使用 /help 查看可用命令`;
  }

  const ctx: CommandContext = {
    message,
    args: parsed.args,
    argsArray: parsed.argsArray,
    namedArgs: parsed.namedArgs,
  };

  try {
    logger.debug({ command: parsed.name, args: parsed.args }, "Executing command");
    return await command.handler(ctx);
  } catch (error) {
    logger.error({ command: parsed.name, error }, "Command execution error");
    return `命令执行错误: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============== 内置命令 ==============

/** 帮助命令 */
const helpCommand: CommandDefinition = {
  name: "help",
  aliases: ["h", "?"],
  description: "显示帮助信息",
  usage: "/help [命令名]",
  handler: (ctx) => {
    const { argsArray } = ctx;

    if (argsArray.length > 0) {
      // 显示特定命令的帮助
      const commandName = argsArray[0]!;
      const command = getCommand(commandName);
      if (!command) {
        return `未知命令: ${commandName}`;
      }
      return `📖 ${command.name}\n\n${command.description}\n\n用法: ${command.usage ?? `/${command.name}`}`;
    }

    // 显示所有命令
    const commands = getAllCommands().filter((c) => !c.hidden);
    const lines = ["📚 可用命令:\n"];

    for (const cmd of commands) {
      lines.push(`  /${cmd.name} - ${cmd.description}`);
    }

    lines.push("\n使用 /help <命令名> 查看详细用法");
    return lines.join("\n");
  },
};

/** 清除会话命令 */
const clearCommand: CommandDefinition = {
  name: "clear",
  aliases: ["reset", "新对话"],
  description: "清除当前会话历史",
  handler: () => {
    return "会话已清除。我们可以开始新的对话了！";
  },
};

/** 状态命令 */
const statusCommand: CommandDefinition = {
  name: "status",
  description: "显示当前状态",
  handler: (ctx) => {
    const lines = [
      "📊 当前状态",
      "",
      `通道: ${ctx.message.channelId}`,
      `会话类型: ${ctx.message.chatType === "group" ? "群聊" : "私聊"}`,
      `发送者: ${ctx.message.senderName ?? ctx.message.senderId}`,
    ];
    return lines.join("\n");
  },
};

/** 注册内置命令 */
export function registerBuiltinCommands(): void {
  registerCommands([helpCommand, clearCommand, statusCommand]);
}
