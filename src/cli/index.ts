#!/usr/bin/env node

/**
 * Mozi CLI - 命令行界面
 */

import { Command } from "commander";
import { loadConfig, validateRequiredConfig } from "../config/index.js";
import { startGateway } from "../gateway/server.js";
import { initializeProviders, getAllProviders, getAllModels } from "../providers/index.js";
import { createLogger, setLogger, getLogDir, getLogFile } from "../utils/logger.js";
import dotenv from "dotenv";
import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// 加载环境变量
dotenv.config();

const program = new Command();

program
  .name("mozi")
  .description("Mozi - 支持国产模型和国产通讯软件的智能助手机器人")
  .version("1.0.0");

// 启动命令
program
  .command("start")
  .description("启动 Gateway 服务器")
  .option("-c, --config <path>", "配置文件路径")
  .option("-p, --port <port>", "服务器端口")
  .option("--web-only", "仅启用 WebChat (不需要配置飞书/钉钉)")
  .action(async (options) => {
    try {
      const config = loadConfig({ configPath: options.config });

      // 覆盖端口
      if (options.port) {
        config.server.port = parseInt(options.port, 10);
      }

      // 验证配置
      const errors = validateRequiredConfig(config, { webOnly: options.webOnly });
      if (errors.length > 0) {
        console.error("❌ 配置错误:");
        errors.forEach((err) => console.error(`   - ${err}`));
        process.exit(1);
      }

      await startGateway(config);
    } catch (error) {
      console.error("❌ 启动失败:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 模型列表命令
program
  .command("models")
  .description("列出可用的模型")
  .action(async () => {
    try {
      const config = loadConfig();
      setLogger(createLogger({ level: "error" })); // 静默日志
      initializeProviders(config);

      const models = getAllModels();

      if (models.length === 0) {
        console.log("没有配置任何模型提供商。请检查 API Key 配置。");
        return;
      }

      console.log("\n可用模型:\n");

      // 按提供商分组
      const byProvider = new Map<string, typeof models>();
      for (const item of models) {
        const list = byProvider.get(item.provider) || [];
        list.push(item);
        byProvider.set(item.provider, list);
      }

      for (const [provider, list] of byProvider) {
        console.log(`📦 ${provider.toUpperCase()}`);
        for (const item of list) {
          const vision = item.model.supportsVision ? " 👁️" : "";
          const reasoning = item.model.supportsReasoning ? " 🧠" : "";
          console.log(`   - ${item.model.id} (${item.model.name})${vision}${reasoning}`);
        }
        console.log("");
      }
    } catch (error) {
      console.error("错误:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 配置检查命令
program
  .command("check")
  .description("检查配置")
  .option("-c, --config <path>", "配置文件路径")
  .action(async (options) => {
    try {
      console.log("正在检查配置...\n");

      const config = loadConfig({ configPath: options.config });

      // 检查提供商
      console.log("📦 模型提供商:");
      const providers = ["deepseek", "zhipu", "dashscope", "kimi", "stepfun", "minimax", "modelscope"] as const;
      for (const id of providers) {
        const providerConfig = config.providers[id];
        const status = providerConfig?.apiKey ? "✅ 已配置" : "⬜ 未配置";
        console.log(`   ${id}: ${status}`);
      }

      // 检查通道
      console.log("\n📱 通讯通道:");
      const channels = [
        { id: "feishu", name: "飞书", config: config.channels.feishu },
        { id: "dingtalk", name: "钉钉", config: config.channels.dingtalk },
      ];
      for (const channel of channels) {
        const status = channel.config ? "✅ 已配置" : "⬜ 未配置";
        console.log(`   ${channel.name}: ${status}`);
      }

      // 检查 Agent
      console.log("\n🤖 Agent 配置:");
      console.log(`   默认模型: ${config.agent.defaultModel}`);
      console.log(`   默认提供商: ${config.agent.defaultProvider}`);
      console.log(`   温度: ${config.agent.temperature}`);
      console.log(`   最大 Token: ${config.agent.maxTokens}`);

      // 检查服务器
      console.log("\n🌐 服务器配置:");
      console.log(`   端口: ${config.server.port}`);
      console.log(`   主机: ${config.server.host || "0.0.0.0"}`);

      // 验证
      const errors = validateRequiredConfig(config);
      if (errors.length > 0) {
        console.log("\n⚠️ 配置问题:");
        errors.forEach((err) => console.log(`   - ${err}`));
      } else {
        console.log("\n✅ 配置检查通过!");
      }
    } catch (error) {
      console.error("❌ 配置错误:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 测试聊天命令
program
  .command("chat")
  .description("测试聊天功能")
  .option("-m, --model <model>", "使用的模型")
  .option("-p, --provider <provider>", "使用的提供商")
  .action(async (options) => {
    try {
      const config = loadConfig();
      setLogger(createLogger({ level: "error" }));
      initializeProviders(config);

      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const model = options.model || config.agent.defaultModel;
      const provider = options.provider || config.agent.defaultProvider;

      console.log(`\n🤖 Mozi 聊天测试`);
      console.log(`   模型: ${model}`);
      console.log(`   提供商: ${provider}`);
      console.log(`   输入 'exit' 退出\n`);

      const { getProvider, findProviderForModel } = await import("../providers/index.js");
      const p = options.provider ? getProvider(options.provider) : findProviderForModel(model);

      if (!p) {
        console.error(`找不到模型 ${model} 的提供商`);
        process.exit(1);
      }

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      const ask = () => {
        rl.question("You: ", async (input) => {
          if (input.toLowerCase() === "exit") {
            console.log("再见!");
            rl.close();
            return;
          }

          messages.push({ role: "user", content: input });

          try {
            process.stdout.write("AI: ");
            let fullResponse = "";

            for await (const chunk of p.chatStream({
              model,
              messages,
              temperature: config.agent.temperature,
              maxTokens: config.agent.maxTokens,
            })) {
              process.stdout.write(chunk.delta);
              fullResponse += chunk.delta;
            }

            console.log("\n");
            messages.push({ role: "assistant", content: fullResponse });
          } catch (error) {
            console.error("\n错误:", error instanceof Error ? error.message : error);
          }

          ask();
        });
      };

      ask();
    } catch (error) {
      console.error("错误:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// 配置引导命令
program
  .command("onboard")
  .description("配置引导向导")
  .action(async () => {
    const readline = await import("readline");
    const fs = await import("fs");
    const path = await import("path");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, resolve);
      });
    };

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🐼 欢迎使用 Mozi (墨子) 配置向导                          ║
║                                                            ║
║   支持国产模型和国产通讯软件的智能助手                       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

    const envLines: string[] = [];

    // 模型配置
    console.log("\n📦 步骤 1/3: 配置模型提供商\n");
    console.log("支持的提供商: DeepSeek, 智谱AI, DashScope(通义千问), Kimi, 阶跃星辰, MiniMax, ModelScope");
    console.log("(至少配置一个，直接回车跳过)\n");

    const deepseekKey = await question("DeepSeek API Key: ");
    if (deepseekKey.trim()) {
      envLines.push(`DEEPSEEK_API_KEY=${deepseekKey.trim()}`);
    }

    const zhipuKey = await question("智谱AI API Key (GLM-4系列，有免费额度): ");
    if (zhipuKey.trim()) {
      envLines.push(`ZHIPU_API_KEY=${zhipuKey.trim()}`);
    }

    const dashscopeKey = await question("DashScope API Key (阿里云灵积，通义千问商业版): ");
    if (dashscopeKey.trim()) {
      envLines.push(`DASHSCOPE_API_KEY=${dashscopeKey.trim()}`);
    }

    const kimiKey = await question("Kimi (Moonshot) API Key: ");
    if (kimiKey.trim()) {
      envLines.push(`KIMI_API_KEY=${kimiKey.trim()}`);
    }

    const stepfunKey = await question("阶跃星辰 API Key: ");
    if (stepfunKey.trim()) {
      envLines.push(`STEPFUN_API_KEY=${stepfunKey.trim()}`);
    }

    const minimaxKey = await question("MiniMax API Key: ");
    if (minimaxKey.trim()) {
      envLines.push(`MINIMAX_API_KEY=${minimaxKey.trim()}`);
      const minimaxGroup = await question("MiniMax Group ID: ");
      if (minimaxGroup.trim()) {
        envLines.push(`MINIMAX_GROUP_ID=${minimaxGroup.trim()}`);
      }
    }

    const modelscopeKey = await question("ModelScope API Key (阿里魔搭社区，有免费额度): ");
    if (modelscopeKey.trim()) {
      envLines.push(`MODELSCOPE_API_KEY=${modelscopeKey.trim()}`);
    }

    // 通道配置
    console.log("\n📱 步骤 2/3: 配置通讯平台\n");
    console.log("支持的平台: 飞书, 钉钉");
    console.log("(可选配置，直接回车跳过)\n");

    const configFeishu = await question("是否配置飞书? (y/n): ");
    if (configFeishu.toLowerCase() === "y") {
      const feishuAppId = await question("飞书 App ID: ");
      const feishuAppSecret = await question("飞书 App Secret: ");
      if (feishuAppId.trim() && feishuAppSecret.trim()) {
        envLines.push(`FEISHU_APP_ID=${feishuAppId.trim()}`);
        envLines.push(`FEISHU_APP_SECRET=${feishuAppSecret.trim()}`);
        const encryptKey = await question("飞书 Encrypt Key (可选): ");
        if (encryptKey.trim()) {
          envLines.push(`FEISHU_ENCRYPT_KEY=${encryptKey.trim()}`);
        }
      }
    }

    const configDingtalk = await question("是否配置钉钉? (y/n): ");
    if (configDingtalk.toLowerCase() === "y") {
      const dingtalkKey = await question("钉钉 App Key: ");
      const dingtalkSecret = await question("钉钉 App Secret: ");
      if (dingtalkKey.trim() && dingtalkSecret.trim()) {
        envLines.push(`DINGTALK_APP_KEY=${dingtalkKey.trim()}`);
        envLines.push(`DINGTALK_APP_SECRET=${dingtalkSecret.trim()}`);
        const robotCode = await question("钉钉 Robot Code (可选): ");
        if (robotCode.trim()) {
          envLines.push(`DINGTALK_ROBOT_CODE=${robotCode.trim()}`);
        }
      }
    }

    // 服务器配置
    console.log("\n🌐 步骤 3/3: 配置服务器\n");

    const port = await question("服务器端口 (默认 18789): ");
    envLines.push(`MOZI_PORT=${port.trim() || "18789"}`);

    // 写入 .env 文件
    console.log("\n");

    if (envLines.length > 0) {
      const envContent = envLines.join("\n") + "\n";
      const envPath = path.join(process.cwd(), ".env");

      const writeEnv = await question(`是否写入配置到 ${envPath}? (y/n): `);
      if (writeEnv.toLowerCase() === "y") {
        fs.writeFileSync(envPath, envContent);
        console.log(`\n✅ 配置已保存到 ${envPath}`);
      } else {
        console.log("\n📋 以下是您的配置，请手动保存到 .env 文件:\n");
        console.log("---");
        console.log(envContent);
        console.log("---");
      }
    }

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ✅ 配置完成!                                             ║
║                                                            ║
║   下一步:                                                  ║
║                                                            ║
║   1. 检查配置: mozi check                                  ║
║   2. 启动服务: mozi start                                  ║
║   3. 测试聊天: mozi chat                                   ║
║                                                            ║
║   文档: https://github.com/King-Chau/mozi              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

    rl.close();
  });

// 日志查看命令
program
  .command("logs")
  .description("查看日志")
  .option("-f, --follow", "实时跟踪日志 (类似 tail -f)")
  .option("-n, --lines <number>", "显示最后 N 行", "50")
  .option("-l, --list", "列出所有日志文件")
  .option("--date <date>", "查看指定日期的日志 (格式: YYYY-MM-DD)")
  .option("--level <level>", "过滤日志级别 (debug, info, warn, error)")
  .option("--pretty", "格式化输出 (默认开启)", true)
  .action(async (options) => {
    const logDir = getLogDir();

    // 列出所有日志文件
    if (options.list) {
      console.log(`\n日志目录: ${logDir}\n`);

      if (!existsSync(logDir)) {
        console.log("暂无日志文件");
        return;
      }

      const files = readdirSync(logDir)
        .filter((f) => f.endsWith(".log"))
        .sort()
        .reverse();

      if (files.length === 0) {
        console.log("暂无日志文件");
        return;
      }

      console.log("日志文件:");
      for (const file of files) {
        const filePath = join(logDir, file);
        const stats = statSync(filePath);
        const size = (stats.size / 1024).toFixed(1);
        console.log(`  ${file}  (${size} KB)`);
      }
      return;
    }

    // 确定要查看的日志文件
    let logFile: string;
    if (options.date) {
      logFile = join(logDir, `mozi-${options.date}.log`);
    } else {
      logFile = getLogFile();
    }

    if (!existsSync(logFile)) {
      console.error(`日志文件不存在: ${logFile}`);
      console.log(`\n提示: 使用 'mozi logs --list' 查看所有日志文件`);
      return;
    }

    console.log(`日志文件: ${logFile}\n`);

    // 实时跟踪模式
    if (options.follow) {
      console.log("正在跟踪日志... (Ctrl+C 退出)\n");

      const args = ["-f", logFile];
      if (options.lines) {
        args.unshift("-n", options.lines);
      }

      const tail = spawn("tail", args, { stdio: "pipe" });

      tail.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          printLogLine(line, options.level, options.pretty);
        }
      });

      tail.stderr.on("data", (data: Buffer) => {
        console.error(data.toString());
      });

      process.on("SIGINT", () => {
        tail.kill();
        process.exit(0);
      });

      return;
    }

    // 显示最后 N 行
    const content = readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const lastN = parseInt(options.lines, 10) || 50;
    const displayLines = lines.slice(-lastN);

    for (const line of displayLines) {
      printLogLine(line, options.level, options.pretty);
    }

    console.log(`\n显示最后 ${displayLines.length} 条日志`);
    console.log(`提示: 使用 'mozi logs -f' 实时跟踪日志`);
  });

/** 打印日志行 */
function printLogLine(line: string, levelFilter?: string, pretty?: boolean): void {
  try {
    const log = JSON.parse(line);

    // 级别过滤
    if (levelFilter) {
      const levelOrder = ["debug", "info", "warn", "error"];
      const logLevel = levelOrder.indexOf(log.level?.toString() || "info");
      const filterLevel = levelOrder.indexOf(levelFilter);
      if (logLevel < filterLevel) return;
    }

    if (pretty) {
      // 格式化输出
      const time = log.time ? new Date(log.time).toLocaleString() : "";
      const level = (log.level || "INFO").toString().toUpperCase().padEnd(5);
      const module = log.module ? `[${log.module}]` : "";
      const msg = log.msg || "";

      // 颜色
      let levelColor = "\x1b[0m"; // reset
      if (log.level === 30 || log.level === "info") levelColor = "\x1b[32m"; // green
      else if (log.level === 40 || log.level === "warn") levelColor = "\x1b[33m"; // yellow
      else if (log.level === 50 || log.level === "error") levelColor = "\x1b[31m"; // red
      else if (log.level === 20 || log.level === "debug") levelColor = "\x1b[36m"; // cyan

      console.log(`\x1b[90m${time}\x1b[0m ${levelColor}${level}\x1b[0m ${module} ${msg}`);

      // 显示额外字段
      const extraKeys = Object.keys(log).filter(
        (k) => !["time", "level", "module", "msg", "name", "pid", "hostname"].includes(k)
      );
      if (extraKeys.length > 0) {
        const extra: Record<string, unknown> = {};
        for (const k of extraKeys) extra[k] = log[k];
        console.log(`  \x1b[90m${JSON.stringify(extra)}\x1b[0m`);
      }
    } else {
      console.log(line);
    }
  } catch {
    // 非 JSON 格式，直接输出
    console.log(line);
  }
}

program.parse();
