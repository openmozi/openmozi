/**
 * 浏览器会话管理
 *
 * 参考 moltbot 的 pw-session.ts 实现
 * 管理浏览器实例的生命周期、页面状态追踪
 */

import type {
  BrowserSessionState,
  BrowserProfile,
  RefMap,
  ElementRef,
  ConsoleLogEntry,
  PageError,
  NetworkRequest,
} from "./types.js";
import { getProfileDataDir, ProfileManager } from "./profiles.js";

/** 活跃会话 */
const activeSessions = new Map<string, BrowserSessionState>();

/** Playwright 模块缓存 */
let playwrightModule: any = null;

/** 延迟加载 Playwright */
async function getPlaywright() {
  if (!playwrightModule) {
    try {
      playwrightModule = await import("playwright-core");
    } catch {
      throw new Error("Playwright not installed. Run: npm install playwright-core");
    }
  }
  return playwrightModule;
}

/**
 * 启动浏览器会话
 */
export async function startSession(options: {
  profileName?: string;
  headless?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  executablePath?: string;
}): Promise<BrowserSessionState> {
  const {
    profileName = "default",
    headless = true,
    viewportWidth = 1280,
    viewportHeight = 720,
    executablePath,
  } = options;

  // 检查是否已有该配置文件的会话
  const existing = activeSessions.get(profileName);
  if (existing) {
    return existing;
  }

  // 获取或创建配置文件
  const manager = new ProfileManager();
  let profile = manager.get(profileName);
  if (!profile) {
    profile = manager.create({ name: profileName, isDefault: profileName === "default" });
  }

  const playwright = await getPlaywright();

  const launchOptions: any = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      `--remote-debugging-port=${profile.cdpPort}`,
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  // 设置用户数据目录
  const userDataDir = getProfileDataDir(profileName);

  // 使用 launchPersistentContext 以支持持久化配置
  const context = await playwright.chromium.launchPersistentContext(userDataDir, {
    ...launchOptions,
    viewport: { width: viewportWidth, height: viewportHeight },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  const session: BrowserSessionState = {
    profileName,
    browser: context.browser?.() ?? context,
    context,
    page,
    refs: new Map(),
    refsMode: "role",
    headless,
    startedAt: Date.now(),
    consoleLogs: [],
    pageErrors: [],
    networkRequests: [],
  };

  // 监听页面事件
  observePage(page, session);

  activeSessions.set(profileName, session);
  return session;
}

/**
 * 监听页面事件 (控制台、错误、网络)
 */
function observePage(page: any, session: BrowserSessionState): void {
  const maxLogs = 100;

  // 控制台日志
  page.on("console", (msg: any) => {
    const entry: ConsoleLogEntry = {
      type: msg.type() as ConsoleLogEntry["type"],
      text: msg.text(),
      timestamp: Date.now(),
    };
    session.consoleLogs.push(entry);
    if (session.consoleLogs.length > maxLogs) {
      session.consoleLogs.shift();
    }
  });

  // 页面错误
  page.on("pageerror", (error: any) => {
    const entry: PageError = {
      message: error.message || String(error),
      stack: error.stack,
      timestamp: Date.now(),
    };
    session.pageErrors.push(entry);
    if (session.pageErrors.length > maxLogs) {
      session.pageErrors.shift();
    }
  });

  // 网络请求
  page.on("response", (response: any) => {
    const request: NetworkRequest = {
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      timestamp: Date.now(),
    };
    session.networkRequests.push(request);
    if (session.networkRequests.length > maxLogs) {
      session.networkRequests.shift();
    }
  });
}

/**
 * 获取活跃会话
 */
export function getSession(profileName = "default"): BrowserSessionState | undefined {
  return activeSessions.get(profileName);
}

/**
 * 获取或抛出活跃会话
 */
export function requireSession(profileName = "default"): BrowserSessionState {
  const session = activeSessions.get(profileName);
  if (!session) {
    throw new Error(`No active browser session for profile "${profileName}". Use 'start' action first.`);
  }
  return session;
}

/**
 * 停止浏览器会话
 */
export async function stopSession(profileName = "default"): Promise<boolean> {
  const session = activeSessions.get(profileName);
  if (!session) return false;

  try {
    const context = session.context as any;
    await context.close();
  } catch {
    // 忽略关闭错误
  }

  activeSessions.delete(profileName);
  return true;
}

/**
 * 停止所有会话
 */
export async function stopAllSessions(): Promise<void> {
  const profileNames = Array.from(activeSessions.keys());
  for (const name of profileNames) {
    await stopSession(name);
  }
}

/**
 * 列出所有活跃会话
 */
export function listActiveSessions(): Array<{
  profileName: string;
  headless: boolean;
  startedAt: number;
  pageUrl?: string;
  pageTitle?: string;
}> {
  const result: Array<{
    profileName: string;
    headless: boolean;
    startedAt: number;
    pageUrl?: string;
    pageTitle?: string;
  }> = [];

  for (const [name, session] of activeSessions) {
    const page = session.page as any;
    result.push({
      profileName: name,
      headless: session.headless,
      startedAt: session.startedAt,
      pageUrl: page?.url?.() ?? undefined,
    });
  }

  return result;
}

/**
 * 通过 ref 获取元素定位器
 */
export function getRefLocator(page: any, ref: string, session: BrowserSessionState): any {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/i.test(normalized)) {
    const info = session.refs.get(normalized.toLowerCase());
    if (!info) {
      throw new Error(`Unknown ref "${normalized}". Run a new snapshot first.`);
    }

    const locator = info.name
      ? page.getByRole(info.role, { name: info.name, exact: true })
      : page.getByRole(info.role);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  // CSS 选择器后备
  return page.locator(ref);
}

/**
 * 解析 ARIA 快照，生成元素引用
 */
export function parseAriaSnapshot(snapshot: string): RefMap {
  const refs: RefMap = new Map();
  let refCounter = 1;

  const interactiveRoles = new Set([
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "listbox", "option", "menuitem", "tab", "switch", "slider",
    "searchbox", "spinbutton", "menuitemcheckbox", "menuitemradio",
    "treeitem", "gridcell", "row", "cell",
  ]);

  const lines = snapshot.split("\n");
  const roleCounters = new Map<string, Map<string, number>>();

  for (const line of lines) {
    const match = line.match(/^\s*-\s+(\w+)(?:\s+"([^"]*)")?/);
    if (!match) continue;

    const role = match[1] as string;
    const name = match[2] as string | undefined;

    if (!interactiveRoles.has(role)) continue;

    const key = `${role}:${name || ""}`;
    if (!roleCounters.has(role)) {
      roleCounters.set(role, new Map());
    }
    const roleMap = roleCounters.get(role)!;
    const count = roleMap.get(key) || 0;
    roleMap.set(key, count + 1);

    refs.set(`e${refCounter}`, {
      role,
      name: name || undefined,
      nth: count > 0 ? count : undefined,
    });
    refCounter++;
  }

  return refs;
}

/**
 * 生成带 ref 标记的快照文本
 */
export function generateRefSnapshot(refs: RefMap): string {
  const lines: string[] = [];
  for (const [ref, info] of refs) {
    const nameStr = info.name ? ` "${info.name}"` : "";
    const nthStr = info.nth !== undefined ? ` [${info.nth}]` : "";
    lines.push(`[${ref}] ${info.role}${nameStr}${nthStr}`);
  }
  return lines.join("\n");
}

/**
 * 获取页面调试信息
 */
export function getSessionDebugInfo(profileName = "default"): {
  consoleLogs: ConsoleLogEntry[];
  pageErrors: PageError[];
  networkRequests: NetworkRequest[];
} | null {
  const session = activeSessions.get(profileName);
  if (!session) return null;

  return {
    consoleLogs: [...session.consoleLogs],
    pageErrors: [...session.pageErrors],
    networkRequests: [...session.networkRequests],
  };
}
