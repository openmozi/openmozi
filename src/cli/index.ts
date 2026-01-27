#!/usr/bin/env node

/**
 * Mozi CLI - 命令行界面
 */

import { Command } from "commander";
import { loadConfig, validateRequiredConfig } from "../config/index.js";
import { startGateway } from "../gateway/server.js";
import { initializeProviders, getAllProviders, getAllModels } from "../providers/index.js";
import { createLogger, setLogger } from "../utils/logger.js";
import dotenv from "dotenv";

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
      const providers = ["deepseek", "minimax", "kimi", "stepfun", "modelscope"] as const;
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
    console.log("支持的提供商: DeepSeek, Kimi, 阶跃星辰, MiniMax, ModelScope (魔搭)");
    console.log("(至少配置一个，直接回车跳过)\n");

    const deepseekKey = await question("DeepSeek API Key: ");
    if (deepseekKey.trim()) {
      envLines.push(`DEEPSEEK_API_KEY=${deepseekKey.trim()}`);
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

    const modelscopeKey = await question("ModelScope/DashScope API Key (阿里云): ");
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

program.parse();
