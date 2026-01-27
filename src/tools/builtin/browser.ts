/**
 * 内置工具 - 浏览器控制
 *
 * 基于 Playwright 实现的浏览器自动化工具
 * 支持页面导航、截图、内容提取、元素交互等功能
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolResult } from "../types.js";
import { jsonResult, errorResult, readStringParam, readNumberParam, readBooleanParam } from "../common.js";

// 浏览器会话状态
interface BrowserSession {
  browser: unknown;
  page: unknown;
  cdpUrl?: string;
}

let browserSession: BrowserSession | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playwrightModule: any = null;

/** 延迟加载 Playwright */
async function getPlaywright() {
  if (!playwrightModule) {
    try {
      // @ts-ignore - 动态导入可选依赖
      playwrightModule = await import("playwright-core");
    } catch {
      throw new Error("Playwright not installed. Run: npm install playwright-core");
    }
  }
  return playwrightModule;
}

/** 获取或创建浏览器会话 */
async function getBrowserSession(): Promise<BrowserSession> {
  if (browserSession) {
    return browserSession;
  }
  throw new Error("Browser not started. Use 'start' action first.");
}

/** 浏览器控制工具 */
export function createBrowserTool(): Tool {
  return {
    name: "browser",
    label: "Browser Control",
    description: `Control a browser for web automation tasks.

Actions:
- start: Launch browser (headless by default)
- stop: Close browser
- navigate: Go to a URL
- screenshot: Take a screenshot
- snapshot: Get page content as text
- click: Click an element
- type: Type text into an element
- scroll: Scroll the page
- evaluate: Execute JavaScript
- wait: Wait for a condition`,
    parameters: Type.Object({
      action: Type.String({
        description: "Action to perform: start, stop, navigate, screenshot, snapshot, click, type, scroll, evaluate, wait",
      }),
      url: Type.Optional(Type.String({ description: "URL for navigate action" })),
      selector: Type.Optional(Type.String({ description: "CSS selector for element actions" })),
      text: Type.Optional(Type.String({ description: "Text for type action" })),
      code: Type.Optional(Type.String({ description: "JavaScript code for evaluate action" })),
      headless: Type.Optional(Type.Boolean({ description: "Run browser headless (default: true)" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
      fullPage: Type.Optional(Type.Boolean({ description: "Take full page screenshot (default: false)" })),
      direction: Type.Optional(Type.String({ description: "Scroll direction: up, down, left, right" })),
      amount: Type.Optional(Type.Number({ description: "Scroll amount in pixels" })),
      waitFor: Type.Optional(Type.String({ description: "Wait condition: selector, text, timeout" })),
      value: Type.Optional(Type.String({ description: "Value for wait condition" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true })!;
      const timeout = readNumberParam(params, "timeout", { min: 1000, max: 120000 }) ?? 30000;

      try {
        switch (action) {
          case "start":
            return await startBrowser(params);
          case "stop":
            return await stopBrowser();
          case "navigate":
            return await navigateTo(params, timeout);
          case "screenshot":
            return await takeScreenshot(params);
          case "snapshot":
            return await getSnapshot(params, timeout);
          case "click":
            return await clickElement(params, timeout);
          case "type":
            return await typeText(params, timeout);
          case "scroll":
            return await scrollPage(params);
          case "evaluate":
            return await evaluateScript(params, timeout);
          case "wait":
            return await waitFor(params, timeout);
          default:
            return errorResult(`Unknown action: ${action}`);
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** 启动浏览器 */
async function startBrowser(params: Record<string, unknown>): Promise<ToolResult> {
  if (browserSession) {
    return jsonResult({ status: "already_running", message: "Browser is already running" });
  }

  const headless = readBooleanParam(params, "headless") ?? true;
  const playwright = await getPlaywright();

  try {
    const browser = await playwright.chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await (browser as any).newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    browserSession = { browser, page };

    return jsonResult({
      status: "started",
      headless,
      viewport: { width: 1280, height: 720 },
    });
  } catch (error) {
    return errorResult(`Failed to start browser: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 停止浏览器 */
async function stopBrowser(): Promise<ToolResult> {
  if (!browserSession) {
    return jsonResult({ status: "not_running", message: "Browser is not running" });
  }

  try {
    await (browserSession.browser as any).close();
    browserSession = null;
    return jsonResult({ status: "stopped" });
  } catch (error) {
    browserSession = null;
    return errorResult(`Error closing browser: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 导航到 URL */
async function navigateTo(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const url = readStringParam(params, "url", { required: true })!;

  try {
    new URL(url); // 验证 URL
  } catch {
    return errorResult(`Invalid URL: ${url}`);
  }

  const page = session.page as any;
  await page.goto(url, { timeout, waitUntil: "domcontentloaded" });

  return jsonResult({
    status: "navigated",
    url: page.url(),
    title: await page.title(),
  });
}

/** 截图 */
async function takeScreenshot(params: Record<string, unknown>): Promise<ToolResult> {
  const session = await getBrowserSession();
  const fullPage = readBooleanParam(params, "fullPage") ?? false;

  const page = session.page as any;
  const buffer = await page.screenshot({
    fullPage,
    type: "png",
  });

  const base64 = buffer.toString("base64");

  return jsonResult({
    status: "screenshot_taken",
    fullPage,
    size: buffer.length,
    base64: base64.slice(0, 100) + "...", // 只返回前100字符作为预览
    dataUrl: `data:image/png;base64,${base64}`,
  });
}

/** 获取页面快照 */
async function getSnapshot(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = session.page as any;

  const title = await page.title();
  const url = page.url();

  // 提取页面文本内容 - 使用字符串形式避免 TypeScript DOM 类型问题
  const content = await page.evaluate(`
    (() => {
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach(el => el.remove());
      return document.body?.innerText ?? "";
    })()
  `);

  // 获取链接
  const links = await page.evaluate(`
    (() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors.slice(0, 20).map(a => ({
        text: (a.innerText || "").slice(0, 50),
        href: a.href,
      }));
    })()
  `);

  // 获取表单元素
  const forms = await page.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll("input, textarea, select, button"));
      return inputs.slice(0, 20).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
      }));
    })()
  `);

  // 截断内容
  const contentStr = String(content || "");
  const truncatedContent = contentStr.length > 5000 ? contentStr.slice(0, 5000) + "...[truncated]" : contentStr;

  return jsonResult({
    status: "snapshot",
    url,
    title,
    contentLength: contentStr.length,
    content: truncatedContent,
    links,
    forms,
  });
}

/** 点击元素 */
async function clickElement(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const selector = readStringParam(params, "selector", { required: true })!;

  const page = session.page as any;
  await page.click(selector, { timeout });

  return jsonResult({
    status: "clicked",
    selector,
  });
}

/** 输入文本 */
async function typeText(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const selector = readStringParam(params, "selector", { required: true })!;
  const text = readStringParam(params, "text", { required: true })!;

  const page = session.page as any;
  await page.fill(selector, text, { timeout });

  return jsonResult({
    status: "typed",
    selector,
    text: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
  });
}

/** 滚动页面 */
async function scrollPage(params: Record<string, unknown>): Promise<ToolResult> {
  const session = await getBrowserSession();
  const direction = readStringParam(params, "direction") ?? "down";
  const amount = readNumberParam(params, "amount", { min: 100, max: 10000 }) ?? 500;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = session.page as any;

  let deltaX = 0;
  let deltaY = 0;

  switch (direction) {
    case "up":
      deltaY = -amount;
      break;
    case "down":
      deltaY = amount;
      break;
    case "left":
      deltaX = -amount;
      break;
    case "right":
      deltaX = amount;
      break;
  }

  await page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);

  return jsonResult({
    status: "scrolled",
    direction,
    amount,
  });
}

/** 执行 JavaScript */
async function evaluateScript(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const code = readStringParam(params, "code", { required: true })!;

  const page = session.page as any;
  const result = await page.evaluate(code);

  return jsonResult({
    status: "evaluated",
    result: JSON.stringify(result, null, 2).slice(0, 2000),
  });
}

/** 等待条件 */
async function waitFor(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const waitForCondition = readStringParam(params, "waitFor") ?? "timeout";
  const value = readStringParam(params, "value");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = session.page as any;

  switch (waitForCondition) {
    case "selector":
      if (!value) return errorResult("Selector value required");
      await page.waitForSelector(value, { timeout });
      return jsonResult({ status: "waited", condition: "selector", selector: value });

    case "text": {
      if (!value) return errorResult("Text value required");
      const escapedText = value.replace(/'/g, "\\'");
      await page.waitForFunction(
        `document.body?.innerText?.includes('${escapedText}')`,
        { timeout }
      );
      return jsonResult({ status: "waited", condition: "text", text: value });
    }

    case "timeout": {
      const ms = readNumberParam(params, "amount", { min: 100, max: 30000 }) ?? 1000;
      await page.waitForTimeout(ms);
      return jsonResult({ status: "waited", condition: "timeout", ms });
    }

    case "load":
      await page.waitForLoadState("load", { timeout });
      return jsonResult({ status: "waited", condition: "load" });

    case "network":
      await page.waitForLoadState("networkidle", { timeout });
      return jsonResult({ status: "waited", condition: "networkidle" });

    default:
      return errorResult(`Unknown wait condition: ${waitForCondition}`);
  }
}
