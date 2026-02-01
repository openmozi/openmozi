/**
 * 浏览器服务 - 统一管理入口
 *
 * 提供浏览器控制的高级 API，整合会话、截图、操作等功能
 */

import type {
  BrowserConfig,
  BrowserAction,
  BrowserActionResult,
  ScreenshotOptions,
  ScreenshotResult,
  SnapshotOptions,
  SnapshotResult,
  BrowserTab,
} from "./types.js";
import { DEFAULT_BROWSER_CONFIG } from "./types.js";
import { ProfileManager } from "./profiles.js";
import {
  startSession,
  stopSession,
  stopAllSessions,
  getSession,
  requireSession,
  listActiveSessions,
  getRefLocator,
  getSessionDebugInfo,
} from "./session.js";
import { takeScreenshot, getPageSnapshot } from "./screenshot.js";

/**
 * 浏览器服务类
 */
export class BrowserService {
  private config: BrowserConfig;
  private profileManager: ProfileManager;

  constructor(config?: Partial<BrowserConfig>) {
    this.config = { ...DEFAULT_BROWSER_CONFIG, ...config };
    this.profileManager = new ProfileManager();
  }

  /** 获取配置文件管理器 */
  getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  /** 启动浏览器 */
  async start(options?: {
    profileName?: string;
    headless?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  }): Promise<{ status: string; profileName: string; headless: boolean }> {
    const session = await startSession({
      profileName: options?.profileName ?? this.config.defaultProfile,
      headless: options?.headless ?? this.config.headless,
      viewportWidth: options?.viewportWidth ?? this.config.viewportWidth,
      viewportHeight: options?.viewportHeight ?? this.config.viewportHeight,
      executablePath: this.config.executablePath,
    });

    return {
      status: "started",
      profileName: session.profileName,
      headless: session.headless,
    };
  }

  /** 停止浏览器 */
  async stop(profileName?: string): Promise<{ status: string; stopped: boolean }> {
    const stopped = await stopSession(profileName ?? this.config.defaultProfile);
    return { status: stopped ? "stopped" : "not_running", stopped };
  }

  /** 停止所有浏览器 */
  async stopAll(): Promise<{ status: string }> {
    await stopAllSessions();
    return { status: "all_stopped" };
  }

  /** 获取活跃会话列表 */
  listSessions() {
    return listActiveSessions();
  }

  /** 导航到 URL */
  async navigate(url: string, profileName?: string): Promise<{
    status: string;
    url: string;
    title: string;
  }> {
    const session = requireSession(profileName ?? this.config.defaultProfile);
    const page = session.page as any;

    // 验证 URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    await page.goto(url, {
      timeout: this.config.defaultTimeout,
      waitUntil: "domcontentloaded",
    });

    // 清除旧的 refs
    session.refs.clear();

    return {
      status: "navigated",
      url: page.url(),
      title: await page.title(),
    };
  }

  /** 截图 */
  async screenshot(options?: ScreenshotOptions, profileName?: string): Promise<ScreenshotResult> {
    return takeScreenshot(options, profileName ?? this.config.defaultProfile);
  }

  /** 获取页面快照 */
  async snapshot(options?: SnapshotOptions, profileName?: string): Promise<SnapshotResult> {
    return getPageSnapshot(options, profileName ?? this.config.defaultProfile);
  }

  /** 获取标签页列表 */
  async getTabs(profileName?: string): Promise<BrowserTab[]> {
    const session = requireSession(profileName ?? this.config.defaultProfile);
    const context = session.context as any;
    const pages = context.pages();

    return pages.map((page: any, index: number) => ({
      targetId: String(index),
      title: page.title() || "",
      url: page.url(),
      type: "page",
    }));
  }

  /** 执行浏览器操作 */
  async executeAction(action: BrowserAction, profileName?: string): Promise<BrowserActionResult> {
    const session = requireSession(profileName ?? this.config.defaultProfile);
    const page = session.page as any;
    const timeout = this.config.defaultTimeout;

    try {
      switch (action.kind) {
        case "click": {
          const locator = getRefLocator(page, action.ref, session);
          const options: any = { timeout, button: action.button || "left" };
          if (action.modifiers?.length) {
            options.modifiers = action.modifiers;
          }
          if (action.doubleClick) {
            await locator.dblclick(options);
          } else {
            await locator.click(options);
          }
          return { success: true, action: "click", details: { ref: action.ref, doubleClick: action.doubleClick } };
        }

        case "type": {
          const locator = getRefLocator(page, action.ref, session);
          if (action.slowly) {
            await locator.click({ timeout });
            await locator.type(action.text, { timeout, delay: 75 });
          } else {
            await locator.fill(action.text, { timeout });
          }
          if (action.submit) {
            await locator.press("Enter", { timeout });
          }
          return { success: true, action: "type", details: { ref: action.ref, textLength: action.text.length } };
        }

        case "press": {
          await page.keyboard.press(action.key);
          return { success: true, action: "press", details: { key: action.key } };
        }

        case "hover": {
          const locator = getRefLocator(page, action.ref, session);
          await locator.hover({ timeout });
          return { success: true, action: "hover", details: { ref: action.ref } };
        }

        case "scroll": {
          if (action.ref) {
            const locator = getRefLocator(page, action.ref, session);
            await locator.scrollIntoViewIfNeeded({ timeout });
            return { success: true, action: "scroll", details: { ref: action.ref } };
          }
          const amount = action.amount ?? 500;
          let deltaX = 0, deltaY = 0;
          switch (action.direction) {
            case "up": deltaY = -amount; break;
            case "down": deltaY = amount; break;
            case "left": deltaX = -amount; break;
            case "right": deltaX = amount; break;
          }
          await page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);
          return { success: true, action: "scroll", details: { direction: action.direction, amount } };
        }

        case "drag": {
          const startLocator = getRefLocator(page, action.startRef, session);
          const endLocator = getRefLocator(page, action.endRef, session);
          await startLocator.dragTo(endLocator, { timeout });
          return { success: true, action: "drag", details: { startRef: action.startRef, endRef: action.endRef } };
        }

        case "select": {
          const locator = getRefLocator(page, action.ref, session);
          await locator.selectOption(action.values, { timeout });
          return { success: true, action: "select", details: { ref: action.ref, values: action.values } };
        }

        case "fill": {
          const results: Array<{ ref: string; status: string }> = [];
          for (const field of action.fields) {
            try {
              const locator = getRefLocator(page, field.ref, session);
              if (field.type === "checkbox" || field.type === "radio") {
                const checked = field.value === true || field.value === "true" || field.value === 1;
                await locator.setChecked(checked, { timeout });
              } else {
                await locator.fill(String(field.value), { timeout });
              }
              results.push({ ref: field.ref, status: "filled" });
            } catch (err) {
              results.push({ ref: field.ref, status: `error: ${err instanceof Error ? err.message : String(err)}` });
            }
          }
          return { success: true, action: "fill", details: { fields: results } };
        }

        case "wait": {
          switch (action.condition) {
            case "selector":
              if (!action.value) throw new Error("Selector value required");
              await page.waitForSelector(action.value, { timeout });
              break;
            case "text":
              if (!action.value) throw new Error("Text value required");
              await page.getByText(action.value).first().waitFor({ state: "visible", timeout });
              break;
            case "textGone":
              if (!action.value) throw new Error("Text value required");
              await page.getByText(action.value).first().waitFor({ state: "hidden", timeout });
              break;
            case "timeout":
              await page.waitForTimeout(action.amount ?? 1000);
              break;
            case "load":
              await page.waitForLoadState("load", { timeout });
              break;
            case "network":
              await page.waitForLoadState("networkidle", { timeout });
              break;
            case "url":
              if (!action.value) throw new Error("URL pattern required");
              await page.waitForURL(action.value, { timeout });
              break;
          }
          return { success: true, action: "wait", details: { condition: action.condition, value: action.value } };
        }

        case "evaluate": {
          let result: unknown;
          if (action.ref) {
            const locator = getRefLocator(page, action.ref, session);
            result = await locator.evaluate((el: any, code: string) => eval(code), action.code);
          } else {
            result = await page.evaluate(action.code);
          }
          return { success: true, action: "evaluate", details: { result: JSON.stringify(result, null, 2).slice(0, 2000) } };
        }

        case "close": {
          await page.close();
          return { success: true, action: "close" };
        }

        default:
          return { success: false, action: "unknown", error: `Unknown action kind` };
      }
    } catch (error) {
      return {
        success: false,
        action: action.kind,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 获取调试信息 */
  getDebugInfo(profileName?: string) {
    return getSessionDebugInfo(profileName ?? this.config.defaultProfile);
  }
}

/** 默认浏览器服务实例 */
let defaultService: BrowserService | null = null;

/** 获取默认浏览器服务 */
export function getBrowserService(config?: Partial<BrowserConfig>): BrowserService {
  if (!defaultService) {
    defaultService = new BrowserService(config);
  }
  return defaultService;
}
