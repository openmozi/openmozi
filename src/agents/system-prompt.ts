/**
 * 系统提示构建器
 * 参考 moltbot 的 system-prompt.ts
 */

import * as os from "os";
import * as path from "path";
import type { Tool } from "../tools/types.js";

/** 系统提示选项 */
export interface SystemPromptOptions {
  /** 基础系统提示 */
  basePrompt?: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 是否包含环境信息 */
  includeEnvironment?: boolean;
  /** 是否包含日期时间 */
  includeDateTime?: boolean;
  /** 是否包含工具使用规则 */
  includeToolRules?: boolean;
  /** 可用工具列表 (用于生成工具使用指南) */
  tools?: Tool[];
  /** 额外的上下文 (如之前的摘要) */
  additionalContext?: string;
  /** 用户名 */
  userName?: string;
}

/** 获取平台信息 */
function getPlatformInfo(): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  const platformNames: Record<string, string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
  };

  const platformName = platformNames[platform] ?? platform;

  return `${platformName} ${release} (${arch})`;
}

/** 获取当前日期时间 */
function getCurrentDateTime(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timeStr = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${dateStr} ${timeStr}`;
}

/** 获取 Shell 信息 */
function getShellInfo(): string {
  return process.env.SHELL ?? "/bin/bash";
}

/** 构建环境信息部分 */
function buildEnvironmentSection(options: SystemPromptOptions): string {
  const cwd = options.workingDirectory ?? process.cwd();
  const sections: string[] = [];

  sections.push(`<environment>`);
  sections.push(`Working directory: ${cwd}`);
  sections.push(`Platform: ${getPlatformInfo()}`);
  sections.push(`Shell: ${getShellInfo()}`);
  sections.push(`Home: ${os.homedir()}`);

  if (options.includeDateTime !== false) {
    sections.push(`Current time: ${getCurrentDateTime()}`);
  }

  // 检测是否是 git 仓库
  try {
    const gitDir = path.join(cwd, ".git");
    const fs = require("fs");
    if (fs.existsSync(gitDir)) {
      sections.push(`Git repository: Yes`);
    }
  } catch {
    // ignore
  }

  if (options.userName) {
    sections.push(`User: ${options.userName}`);
  }

  sections.push(`</environment>`);

  return sections.join("\n");
}

/** 构建工具使用规则 */
function buildToolRulesSection(tools?: Tool[]): string {
  if (!tools || tools.length === 0) {
    return "";
  }

  const rules: string[] = [
    "",
    "## 工具使用规则",
    "",
    "你可以使用以下工具来完成任务。使用工具时，模型会返回 tool_calls，系统会自动执行并返回结果。",
    "",
    "### 重要原则",
    "",
    "1. **读取优先**: 在修改任何文件之前，必须先使用 read_file 读取文件内容，了解现有代码结构。",
    "2. **最小改动**: 只做必要的修改，不要过度工程化或添加不需要的功能。",
    "3. **安全意识**: 避免执行危险命令，不要泄露敏感信息。",
    "4. **错误处理**: 如果工具执行失败，分析错误原因并尝试修复。",
    "5. **确认结果**: 执行重要操作后，验证结果是否符合预期。",
    "",
    "### 可用工具",
    "",
  ];

  // 按类别分组工具
  const categories: Record<string, Tool[]> = {
    "文件操作": [],
    "命令执行": [],
    "搜索": [],
    "网络": [],
    "其他": [],
  };

  for (const tool of tools) {
    if (["read_file", "write_file", "edit_file", "list_directory"].includes(tool.name)) {
      categories["文件操作"]!.push(tool);
    } else if (["bash", "process"].includes(tool.name)) {
      categories["命令执行"]!.push(tool);
    } else if (["glob", "grep"].includes(tool.name)) {
      categories["搜索"]!.push(tool);
    } else if (["web_search", "web_fetch", "browser"].includes(tool.name)) {
      categories["网络"]!.push(tool);
    } else {
      categories["其他"]!.push(tool);
    }
  }

  for (const [category, categoryTools] of Object.entries(categories)) {
    if (categoryTools.length === 0) continue;

    rules.push(`**${category}**:`);
    for (const tool of categoryTools) {
      const label = tool.label ?? tool.name;
      // 简化描述，只取第一句
      const desc = tool.description.split("\n")[0]?.slice(0, 80) ?? "";
      rules.push(`- \`${tool.name}\`: ${desc}`);
    }
    rules.push("");
  }

  return rules.join("\n");
}

/** 构建文件操作指南 */
function buildFileOperationsGuide(): string {
  return `
### 文件操作最佳实践

**读取文件**:
- 使用 read_file 读取文件，支持 offset 和 limit 参数读取部分内容
- 大文件应分段读取

**编辑文件**:
- 使用 edit_file 进行精确的字符串替换
- old_string 必须是文件中唯一的，否则需要提供更多上下文
- 如果需要替换所有出现，使用 replace_all: true

**创建文件**:
- 使用 write_file 创建新文件或完全重写文件
- 优先编辑现有文件而非重写

**搜索文件**:
- 使用 glob 按文件名模式搜索
- 使用 grep 按内容搜索
`;
}

/** 构建 Bash 使用指南 */
function buildBashGuide(): string {
  return `
### Bash 命令使用指南

**基本规则**:
- 优先使用专用工具（read_file、edit_file 等）而非 bash 的 cat、sed 等
- 对于长时间运行的命令，使用 run_in_background: true
- 命令超时时间最长 10 分钟

**后台进程**:
- 使用 bash 工具的 run_in_background 参数启动后台任务
- 使用 process 工具的 poll 操作获取输出
- 使用 process 工具的 kill 操作终止进程

**安全限制**:
- 禁止执行破坏性命令 (rm -rf /、mkfs 等)
- 禁止修改系统关键配置
`;
}

/** 构建完整系统提示 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const sections: string[] = [];

  // 基础提示
  const basePrompt = options.basePrompt ??
    "你是一个智能编程助手，可以帮助用户完成各种软件开发任务。请用中文回答问题，代码和命令使用英文。";

  sections.push(basePrompt);

  // 环境信息
  if (options.includeEnvironment !== false) {
    sections.push("");
    sections.push(buildEnvironmentSection(options));
  }

  // 工具使用规则
  if (options.includeToolRules !== false && options.tools && options.tools.length > 0) {
    sections.push(buildToolRulesSection(options.tools));
    sections.push(buildFileOperationsGuide());
    sections.push(buildBashGuide());
  }

  // 额外上下文
  if (options.additionalContext) {
    sections.push("");
    sections.push("## 之前的对话摘要");
    sections.push("");
    sections.push(options.additionalContext);
  }

  return sections.join("\n").trim();
}

/** 创建默认系统提示 */
export function createDefaultSystemPrompt(tools?: Tool[]): string {
  return buildSystemPrompt({
    includeEnvironment: true,
    includeDateTime: true,
    includeToolRules: true,
    tools,
  });
}
