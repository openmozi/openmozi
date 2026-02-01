/**
 * 浏览器模块类型定义
 */

/** 浏览器配置文件 */
export interface BrowserProfile {
  /** 配置文件名称 */
  name: string;
  /** CDP 调试端口 */
  cdpPort: number;
  /** 用户数据目录路径 */
  userDataDir: string;
  /** 主题颜色 (十六进制) */
  color?: string;
  /** 是否为默认配置文件 */
  isDefault?: boolean;
  /** 创建时间 */
  createdAt?: number;
}

/** 浏览器配置 */
export interface BrowserConfig {
  /** 是否启用浏览器控制 */
  enabled: boolean;
  /** 是否以无头模式运行 */
  headless: boolean;
  /** 默认配置文件名称 */
  defaultProfile: string;
  /** 配置文件列表 */
  profiles: Record<string, Partial<BrowserProfile>>;
  /** Chrome 可执行文件路径 (可选) */
  executablePath?: string;
  /** 默认视口宽度 */
  viewportWidth: number;
  /** 默认视口高度 */
  viewportHeight: number;
  /** 默认超时时间 (毫秒) */
  defaultTimeout: number;
  /** 截图最大边长 */
  screenshotMaxSide: number;
  /** 截图最大字节数 */
  screenshotMaxBytes: number;
  /** 快照最大字符数 */
  snapshotMaxChars: number;
}

/** 默认浏览器配置 */
export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  enabled: true,
  headless: true,
  defaultProfile: "default",
  profiles: {},
  viewportWidth: 1280,
  viewportHeight: 720,
  defaultTimeout: 30000,
  screenshotMaxSide: 2000,
  screenshotMaxBytes: 5 * 1024 * 1024, // 5MB
  snapshotMaxChars: 80000,
};

/** CDP 端口范围 */
export const CDP_PORT_RANGE_START = 19800;
export const CDP_PORT_RANGE_END = 19899;

/** 配置文件颜色预设 */
export const PROFILE_COLORS = [
  "#FF4500", // Orange-red
  "#0066CC", // Blue
  "#00AA00", // Green
  "#9932CC", // Purple
  "#FF1493", // Pink
  "#FFD700", // Gold
  "#00CED1", // Cyan
  "#8B4513", // Brown
  "#708090", // Slate
  "#2F4F4F", // Dark slate
];

/** 浏览器标签页信息 */
export interface BrowserTab {
  /** 目标 ID */
  targetId: string;
  /** 页面标题 */
  title: string;
  /** 页面 URL */
  url: string;
  /** WebSocket 调试 URL */
  wsUrl?: string;
  /** 目标类型 */
  type?: string;
}

/** 元素引用信息 */
export interface ElementRef {
  /** 角色 */
  role: string;
  /** 名称 */
  name?: string;
  /** 第 n 个相同角色+名称的元素 (从 0 开始) */
  nth?: number;
}

/** 元素引用映射 */
export type RefMap = Map<string, ElementRef>;

/** 浏览器会话状态 */
export interface BrowserSessionState {
  /** 配置文件名称 */
  profileName: string;
  /** Playwright Browser 实例 */
  browser: unknown;
  /** Playwright BrowserContext 实例 */
  context: unknown;
  /** 当前活动页面 */
  page: unknown;
  /** 元素引用映射 */
  refs: RefMap;
  /** 引用模式 */
  refsMode: "aria" | "role";
  /** 是否以无头模式运行 */
  headless: boolean;
  /** 启动时间 */
  startedAt: number;
  /** 控制台日志 */
  consoleLogs: ConsoleLogEntry[];
  /** 页面错误 */
  pageErrors: PageError[];
  /** 网络请求记录 */
  networkRequests: NetworkRequest[];
}

/** 控制台日志条目 */
export interface ConsoleLogEntry {
  type: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  timestamp: number;
}

/** 页面错误 */
export interface PageError {
  message: string;
  stack?: string;
  timestamp: number;
}

/** 网络请求记录 */
export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
}

/** 截图选项 */
export interface ScreenshotOptions {
  /** 是否全页面截图 */
  fullPage?: boolean;
  /** 元素引用 */
  ref?: string;
  /** CSS 选择器 */
  selector?: string;
  /** 图片格式 */
  format?: "png" | "jpeg";
  /** JPEG 质量 (0-100) */
  quality?: number;
  /** 是否绘制元素标签 */
  withLabels?: boolean;
  /** 最大标签数量 */
  maxLabels?: number;
}

/** 截图结果 */
export interface ScreenshotResult {
  /** 图片 Buffer */
  buffer: Buffer;
  /** 内容类型 */
  contentType: "image/png" | "image/jpeg";
  /** 原始尺寸 */
  originalSize?: { width: number; height: number };
  /** 是否被压缩 */
  compressed?: boolean;
  /** 绘制的标签数量 */
  labelsDrawn?: number;
}

/** 快照选项 */
export interface SnapshotOptions {
  /** 最大字符数 */
  maxChars?: number;
  /** 选择器 (默认 body) */
  selector?: string;
  /** 是否包含静态内容 */
  includeStatic?: boolean;
}

/** 快照结果 */
export interface SnapshotResult {
  /** 页面 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** ARIA 快照文本 */
  ariaSnapshot?: string;
  /** 元素引用映射 */
  refs: RefMap;
  /** 元素数量 */
  elementsCount: number;
  /** 是否被截断 */
  truncated?: boolean;
}

/** 浏览器操作请求 */
export type BrowserAction =
  | { kind: "click"; ref: string; doubleClick?: boolean; button?: "left" | "right" | "middle"; modifiers?: string[] }
  | { kind: "type"; ref: string; text: string; slowly?: boolean; submit?: boolean }
  | { kind: "press"; key: string; modifiers?: string[] }
  | { kind: "hover"; ref: string }
  | { kind: "scroll"; ref?: string; direction?: "up" | "down" | "left" | "right"; amount?: number }
  | { kind: "drag"; startRef: string; endRef: string }
  | { kind: "select"; ref: string; values: string[] }
  | { kind: "fill"; fields: Array<{ ref: string; type: string; value: string | boolean | number }> }
  | { kind: "wait"; condition: "selector" | "text" | "textGone" | "timeout" | "load" | "network" | "url"; value?: string; amount?: number }
  | { kind: "evaluate"; code: string; ref?: string }
  | { kind: "close" };

/** 浏览器操作结果 */
export interface BrowserActionResult {
  success: boolean;
  action: string;
  details?: Record<string, unknown>;
  error?: string;
}
