/**
 * 内置工具 - 浏览器控制
 *
 * 基于 Playwright 实现的浏览器自动化工具
 * 支持页面导航、截图、内容提取、元素交互等功能
 *
 * 参考 moltbot 实现，增加了元素引用(ref)系统，支持更丰富的交互操作
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolResult } from "../types.js";
import { jsonResult, errorResult, readStringParam, readNumberParam, readBooleanParam } from "../common.js";

// 浏览器会话状态
interface BrowserSession {
  browser: unknown;
  context: unknown;
  page: unknown;
  // 元素引用映射: ref (如 "e1", "e2") -> { role, name, nth }
  refs: Map<string, { role: string; name?: string; nth?: number }>;
  refsMode: "aria" | "role";
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

/** 通过 ref 获取元素定位器 */
function getRefLocator(page: any, ref: string, session: BrowserSession) {
  // 标准化 ref 格式
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  // 处理 e{数字} 格式的引用
  if (/^e\d+$/i.test(normalized)) {
    const info = session.refs.get(normalized.toLowerCase());
    if (!info) {
      throw new Error(`Unknown ref "${normalized}". Run a new snapshot first.`);
    }

    // 通过角色和名称定位
    const locator = info.name
      ? page.getByRole(info.role, { name: info.name, exact: true })
      : page.getByRole(info.role);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  // 尝试作为 CSS 选择器
  return page.locator(ref);
}

/** 解析 aria 快照，生成元素引用 */
function parseAriaSnapshot(snapshot: string): Map<string, { role: string; name?: string; nth?: number }> {
  const refs = new Map<string, { role: string; name?: string; nth?: number }>();
  let refCounter = 1;

  // 匹配 aria 快照中的角色和名称
  // 格式类似: - button "Submit" 或 - textbox "Email"
  const lines = snapshot.split("\n");
  const roleCounters = new Map<string, Map<string, number>>();

  for (const line of lines) {
    // 匹配: - role "name" 或 - role (无名称)
    const match = line.match(/^\s*-\s+(\w+)(?:\s+"([^"]*)")?/);
    if (match) {
      const role = match[1] as string;
      const name = match[2] as string | undefined;

      // 只为交互元素生成 ref
      const interactiveRoles = [
        "button", "link", "textbox", "checkbox", "radio", "combobox",
        "listbox", "option", "menuitem", "tab", "switch", "slider",
        "searchbox", "spinbutton", "menuitemcheckbox", "menuitemradio",
        "treeitem", "gridcell", "row", "cell"
      ];

      if (interactiveRoles.includes(role)) {
        // 计算 nth 索引
        const key = `${role}:${name || ""}`;
        if (!roleCounters.has(role)) {
          roleCounters.set(role, new Map<string, number>());
        }
        const roleMap = roleCounters.get(role)!;
        const count = roleMap.get(key) || 0;
        roleMap.set(key, count + 1);

        const refKey = `e${refCounter}`;
        refs.set(refKey, {
          role,
          name: name || undefined,
          nth: count > 0 ? count : undefined,
        });
        refCounter++;
      }
    }
  }

  return refs;
}

/** 生成带 ref 标记的快照文本 */
function generateRefSnapshot(refs: Map<string, { role: string; name?: string; nth?: number }>): string {
  const lines: string[] = [];
  for (const [ref, info] of refs) {
    const nameStr = info.name ? ` "${info.name}"` : "";
    const nthStr = info.nth !== undefined ? ` [${info.nth}]` : "";
    lines.push(`[${ref}] ${info.role}${nameStr}${nthStr}`);
  }
  return lines.join("\n");
}

/** 浏览器控制工具 */
export function createBrowserTool(): Tool {
  return {
    name: "browser",
    label: "Browser Control",
    description: `Control a browser for web automation tasks.

Actions:
- start: Launch browser (headless by default, set headless=false to see the browser)
- stop: Close browser
- navigate: Go to a URL
- screenshot: Take a screenshot (supports element screenshot with ref or selector)
- snapshot: Get page accessibility snapshot with element refs (e1, e2, etc.)
- click: Click an element (use ref like "e1" or CSS selector)
- type: Type text into an element (supports slowly mode and submit)
- hover: Hover over an element
- drag: Drag from one element to another
- press: Press a keyboard key
- select: Select option(s) from a dropdown
- scroll: Scroll the page or to an element
- evaluate: Execute JavaScript
- wait: Wait for a condition
- fill: Fill multiple form fields at once

Element Reference System:
- After calling 'snapshot', you'll get refs like e1, e2, e3 for interactive elements
- Use these refs in click, type, hover, drag, select actions
- Refs are more reliable than CSS selectors for AI-driven automation`,
    parameters: Type.Object({
      action: Type.String({
        description: "Action: start, stop, navigate, screenshot, snapshot, click, type, hover, drag, press, select, scroll, evaluate, wait, fill",
      }),
      // Navigation
      url: Type.Optional(Type.String({ description: "URL for navigate action" })),
      // Element targeting
      ref: Type.Optional(Type.String({ description: "Element ref (e.g., 'e1', 'e2') from snapshot" })),
      selector: Type.Optional(Type.String({ description: "CSS selector (fallback if ref not available)" })),
      // Click options
      doubleClick: Type.Optional(Type.Boolean({ description: "Double click instead of single click" })),
      button: Type.Optional(Type.String({ description: "Mouse button: left, right, middle" })),
      modifiers: Type.Optional(Type.Array(Type.String(), { description: "Modifier keys: Alt, Control, Meta, Shift" })),
      // Type options
      text: Type.Optional(Type.String({ description: "Text for type/press action" })),
      slowly: Type.Optional(Type.Boolean({ description: "Type slowly with delay between chars" })),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
      // Press options
      key: Type.Optional(Type.String({ description: "Key to press (e.g., 'Enter', 'Tab', 'ArrowDown')" })),
      // Drag options
      startRef: Type.Optional(Type.String({ description: "Start element ref for drag" })),
      endRef: Type.Optional(Type.String({ description: "End element ref for drag" })),
      // Select options
      values: Type.Optional(Type.Array(Type.String(), { description: "Values to select in dropdown" })),
      // Fill options
      fields: Type.Optional(Type.Array(Type.Object({
        ref: Type.String({ description: "Element ref" }),
        type: Type.String({ description: "Field type: text, checkbox, radio" }),
        value: Type.Union([Type.String(), Type.Boolean(), Type.Number()], { description: "Value to fill" }),
      }), { description: "Form fields to fill" })),
      // Screenshot options
      fullPage: Type.Optional(Type.Boolean({ description: "Take full page screenshot" })),
      // Scroll options
      direction: Type.Optional(Type.String({ description: "Scroll direction: up, down, left, right" })),
      amount: Type.Optional(Type.Number({ description: "Scroll amount in pixels" })),
      // Wait options
      waitFor: Type.Optional(Type.String({ description: "Wait condition: selector, text, textGone, timeout, load, network, url" })),
      value: Type.Optional(Type.String({ description: "Value for wait condition" })),
      // Evaluate options
      code: Type.Optional(Type.String({ description: "JavaScript code for evaluate action" })),
      // General options
      headless: Type.Optional(Type.Boolean({ description: "Run browser headless (default: true)" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
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
            return await takeScreenshot(params, timeout);
          case "snapshot":
            return await getSnapshot(params, timeout);
          case "click":
            return await clickElement(params, timeout);
          case "type":
            return await typeText(params, timeout);
          case "hover":
            return await hoverElement(params, timeout);
          case "drag":
            return await dragElement(params, timeout);
          case "press":
            return await pressKey(params);
          case "select":
            return await selectOption(params, timeout);
          case "scroll":
            return await scrollPage(params, timeout);
          case "evaluate":
            return await evaluateScript(params, timeout);
          case "wait":
            return await waitFor(params, timeout);
          case "fill":
            return await fillForm(params, timeout);
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

    browserSession = {
      browser,
      context,
      page,
      refs: new Map(),
      refsMode: "role",
    };

    return jsonResult({
      status: "started",
      headless,
      viewport: { width: 1280, height: 720 },
      hint: "Use 'snapshot' action to get element refs for interaction",
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

  // 清除旧的 refs
  session.refs.clear();

  return jsonResult({
    status: "navigated",
    url: page.url(),
    title: await page.title(),
    hint: "Use 'snapshot' action to get element refs for interaction",
  });
}

/** 截图 */
async function takeScreenshot(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const fullPage = readBooleanParam(params, "fullPage") ?? false;
  const ref = readStringParam(params, "ref");
  const selector = readStringParam(params, "selector");

  const page = session.page as any;
  let buffer: Buffer;

  if (ref) {
    // 截取特定 ref 元素
    const locator = getRefLocator(page, ref, session);
    buffer = await locator.screenshot({ type: "png", timeout });
  } else if (selector) {
    // 截取 CSS 选择器匹配的元素
    const locator = page.locator(selector).first();
    buffer = await locator.screenshot({ type: "png", timeout });
  } else {
    // 全页面或视口截图
    buffer = await page.screenshot({
      fullPage,
      type: "png",
    });
  }

  const base64 = buffer.toString("base64");

  return jsonResult({
    status: "screenshot_taken",
    fullPage,
    size: buffer.length,
    element: ref || selector || undefined,
    base64: base64.slice(0, 100) + "...",
    dataUrl: `data:image/png;base64,${base64}`,
  });
}

/** 获取页面快照，包含元素引用 */
async function getSnapshot(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const page = session.page as any;

  const title = await page.title();
  const url = page.url();

  // 尝试使用 Playwright 的 ariaSnapshot API
  let ariaSnapshot = "";
  try {
    ariaSnapshot = await page.locator("body").ariaSnapshot();
  } catch {
    // 如果不支持，使用传统方式
  }

  // 解析 aria 快照，生成元素引用
  if (ariaSnapshot) {
    const refs = parseAriaSnapshot(ariaSnapshot);
    session.refs = refs;
    session.refsMode = "role";

    // 生成带 ref 的快照
    const refSnapshot = generateRefSnapshot(refs);

    return jsonResult({
      status: "snapshot",
      url,
      title,
      elementsCount: refs.size,
      elements: refSnapshot,
      ariaSnapshot: ariaSnapshot.length > 8000 ? ariaSnapshot.slice(0, 8000) + "\n...[truncated]" : ariaSnapshot,
      hint: "Use refs like 'e1', 'e2' in click, type, hover actions",
    });
  }

  // 传统方式：提取页面内容
  const content = await page.evaluate(`
    (() => {
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach(el => el.remove());
      return document.body?.innerText ?? "";
    })()
  `);

  // 获取可交互元素
  const interactiveElements = await page.evaluate(`
    (() => {
      const elements = [];
      const selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [onclick]';
      const els = document.querySelectorAll(selectors);
      let index = 1;
      els.forEach(el => {
        if (index > 50) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        elements.push({
          ref: 'e' + index,
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || '',
          text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').slice(0, 50),
          name: el.name || '',
          id: el.id || '',
        });
        index++;
      });
      return elements;
    })()
  `);

  // 更新 refs
  session.refs.clear();
  for (const el of interactiveElements) {
    session.refs.set(el.ref, {
      role: el.tag === "a" ? "link" : el.tag === "button" ? "button" : el.type || el.tag,
      name: el.text || el.name || el.id || undefined,
    });
  }

  const contentStr = String(content || "");
  const truncatedContent = contentStr.length > 5000 ? contentStr.slice(0, 5000) + "...[truncated]" : contentStr;

  return jsonResult({
    status: "snapshot",
    url,
    title,
    contentLength: contentStr.length,
    content: truncatedContent,
    elements: interactiveElements,
    elementsCount: interactiveElements.length,
    hint: "Use refs like 'e1', 'e2' in click, type, hover actions",
  });
}

/** 点击元素 */
async function clickElement(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const ref = readStringParam(params, "ref");
  const selector = readStringParam(params, "selector");
  const doubleClick = readBooleanParam(params, "doubleClick") ?? false;
  const button = readStringParam(params, "button") as "left" | "right" | "middle" | undefined;
  const modifiers = params.modifiers as string[] | undefined;

  if (!ref && !selector) {
    return errorResult("Either 'ref' or 'selector' is required");
  }

  const page = session.page as any;
  const locator = ref ? getRefLocator(page, ref, session) : page.locator(selector!);

  const clickOptions: any = {
    timeout,
    button: button || "left",
  };

  if (modifiers?.length) {
    clickOptions.modifiers = modifiers;
  }

  if (doubleClick) {
    await locator.dblclick(clickOptions);
  } else {
    await locator.click(clickOptions);
  }

  return jsonResult({
    status: "clicked",
    element: ref || selector,
    doubleClick,
    button: button || "left",
  });
}

/** 输入文本 */
async function typeText(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const ref = readStringParam(params, "ref");
  const selector = readStringParam(params, "selector");
  const text = readStringParam(params, "text", { required: true })!;
  const slowly = readBooleanParam(params, "slowly") ?? false;
  const submit = readBooleanParam(params, "submit") ?? false;

  if (!ref && !selector) {
    return errorResult("Either 'ref' or 'selector' is required");
  }

  const page = session.page as any;
  const locator = ref ? getRefLocator(page, ref, session) : page.locator(selector!);

  if (slowly) {
    // 先点击聚焦，然后逐字输入
    await locator.click({ timeout });
    await locator.type(text, { timeout, delay: 75 });
  } else {
    // 直接填充
    await locator.fill(text, { timeout });
  }

  if (submit) {
    await locator.press("Enter", { timeout });
  }

  return jsonResult({
    status: "typed",
    element: ref || selector,
    text: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
    slowly,
    submitted: submit,
  });
}

/** 悬停元素 */
async function hoverElement(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const ref = readStringParam(params, "ref");
  const selector = readStringParam(params, "selector");

  if (!ref && !selector) {
    return errorResult("Either 'ref' or 'selector' is required");
  }

  const page = session.page as any;
  const locator = ref ? getRefLocator(page, ref, session) : page.locator(selector!);

  await locator.hover({ timeout });

  return jsonResult({
    status: "hovered",
    element: ref || selector,
  });
}

/** 拖拽元素 */
async function dragElement(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const startRef = readStringParam(params, "startRef", { required: true })!;
  const endRef = readStringParam(params, "endRef", { required: true })!;

  const page = session.page as any;
  const startLocator = getRefLocator(page, startRef, session);
  const endLocator = getRefLocator(page, endRef, session);

  await startLocator.dragTo(endLocator, { timeout });

  return jsonResult({
    status: "dragged",
    from: startRef,
    to: endRef,
  });
}

/** 按键 */
async function pressKey(params: Record<string, unknown>): Promise<ToolResult> {
  const session = await getBrowserSession();
  const key = readStringParam(params, "key", { required: true })!;

  const page = session.page as any;
  await page.keyboard.press(key);

  return jsonResult({
    status: "pressed",
    key,
  });
}

/** 选择下拉选项 */
async function selectOption(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const ref = readStringParam(params, "ref");
  const selector = readStringParam(params, "selector");
  const values = params.values as string[] | undefined;

  if (!ref && !selector) {
    return errorResult("Either 'ref' or 'selector' is required");
  }
  if (!values?.length) {
    return errorResult("'values' array is required");
  }

  const page = session.page as any;
  const locator = ref ? getRefLocator(page, ref, session) : page.locator(selector!);

  await locator.selectOption(values, { timeout });

  return jsonResult({
    status: "selected",
    element: ref || selector,
    values,
  });
}

/** 滚动页面 */
async function scrollPage(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const ref = readStringParam(params, "ref");
  const direction = readStringParam(params, "direction") ?? "down";
  const amount = readNumberParam(params, "amount", { min: 100, max: 10000 }) ?? 500;

  const page = session.page as any;

  // 如果指定了 ref，滚动到该元素
  if (ref) {
    const locator = getRefLocator(page, ref, session);
    await locator.scrollIntoViewIfNeeded({ timeout });
    return jsonResult({
      status: "scrolled",
      element: ref,
    });
  }

  // 页面滚动
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
  const ref = readStringParam(params, "ref");

  const page = session.page as any;
  let result: unknown;

  if (ref) {
    // 在特定元素上执行
    const locator = getRefLocator(page, ref, session);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await locator.evaluate((el: any, code: string) => {
      // eslint-disable-next-line no-eval
      return eval(code);
    }, code);
  } else {
    result = await page.evaluate(code);
  }

  return jsonResult({
    status: "evaluated",
    element: ref || undefined,
    result: JSON.stringify(result, null, 2).slice(0, 2000),
  });
}

/** 等待条件 */
async function waitFor(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const waitForCondition = readStringParam(params, "waitFor") ?? "timeout";
  const value = readStringParam(params, "value");

  const page = session.page as any;

  switch (waitForCondition) {
    case "selector":
      if (!value) return errorResult("Selector value required");
      await page.waitForSelector(value, { timeout });
      return jsonResult({ status: "waited", condition: "selector", selector: value });

    case "text": {
      if (!value) return errorResult("Text value required");
      await page.getByText(value).first().waitFor({ state: "visible", timeout });
      return jsonResult({ status: "waited", condition: "text", text: value });
    }

    case "textGone": {
      if (!value) return errorResult("Text value required");
      await page.getByText(value).first().waitFor({ state: "hidden", timeout });
      return jsonResult({ status: "waited", condition: "textGone", text: value });
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

    case "url":
      if (!value) return errorResult("URL pattern required");
      await page.waitForURL(value, { timeout });
      return jsonResult({ status: "waited", condition: "url", url: value });

    default:
      return errorResult(`Unknown wait condition: ${waitForCondition}`);
  }
}

/** 批量填充表单 */
async function fillForm(params: Record<string, unknown>, timeout: number): Promise<ToolResult> {
  const session = await getBrowserSession();
  const fields = params.fields as Array<{ ref: string; type: string; value: string | boolean | number }> | undefined;

  if (!fields?.length) {
    return errorResult("'fields' array is required");
  }

  const page = session.page as any;
  const results: Array<{ ref: string; status: string }> = [];

  for (const field of fields) {
    const ref = field.ref?.trim();
    const type = field.type?.trim();
    const rawValue = field.value;

    if (!ref || !type) {
      results.push({ ref: ref || "unknown", status: "skipped" });
      continue;
    }

    const locator = getRefLocator(page, ref, session);

    try {
      if (type === "checkbox" || type === "radio") {
        const checked = rawValue === true || rawValue === 1 || rawValue === "1" || rawValue === "true";
        await locator.setChecked(checked, { timeout });
      } else {
        const value = typeof rawValue === "string" ? rawValue : String(rawValue);
        await locator.fill(value, { timeout });
      }
      results.push({ ref, status: "filled" });
    } catch (error) {
      results.push({ ref, status: `error: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return jsonResult({
    status: "form_filled",
    fields: results,
  });
}
