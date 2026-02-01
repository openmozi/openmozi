/**
 * Chrome 配置文件管理
 *
 * 参考 moltbot 的 profiles.ts 和 chrome.profile-decoration.ts 实现
 * 支持多配置文件管理、端口分配、目录隔离
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import json5 from "json5";
import type { BrowserProfile, BrowserConfig } from "./types.js";
import { CDP_PORT_RANGE_START, CDP_PORT_RANGE_END, PROFILE_COLORS, DEFAULT_BROWSER_CONFIG } from "./types.js";

/** 配置文件名正则 */
const PROFILE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/** 默认浏览器数据目录 */
const BROWSER_DATA_DIR = join(homedir(), ".mozi", "browser");

/** 配置文件存储路径 */
const PROFILES_STORE_PATH = join(BROWSER_DATA_DIR, "profiles.json");

/** 配置文件数据存储 */
interface ProfilesStore {
  version: 1;
  profiles: Record<string, BrowserProfile>;
}

/**
 * 验证配置文件名是否合法
 */
export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_REGEX.test(name) && name.length <= 32;
}

/**
 * 分配 CDP 端口
 */
export function allocateCdpPort(usedPorts: Set<number>): number | null {
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  return null;
}

/**
 * 分配配置文件颜色
 */
export function allocateColor(usedColors: Set<string>): string {
  for (const color of PROFILE_COLORS) {
    if (!usedColors.has(color)) {
      return color;
    }
  }
  return PROFILE_COLORS[0]!;
}

/**
 * 加载配置文件存储
 */
export function loadProfilesStore(): ProfilesStore {
  if (!existsSync(PROFILES_STORE_PATH)) {
    return { version: 1, profiles: {} };
  }
  try {
    const content = readFileSync(PROFILES_STORE_PATH, "utf-8");
    return json5.parse(content) as ProfilesStore;
  } catch {
    return { version: 1, profiles: {} };
  }
}

/**
 * 保存配置文件存储 (原子写入)
 */
export function saveProfilesStore(store: ProfilesStore): void {
  mkdirSync(BROWSER_DATA_DIR, { recursive: true });

  const content = JSON.stringify(store, null, 2);
  const tmpPath = `${PROFILES_STORE_PATH}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, PROFILES_STORE_PATH);
}

/**
 * 获取配置文件的用户数据目录
 */
export function getProfileDataDir(profileName: string): string {
  return join(BROWSER_DATA_DIR, "profiles", profileName);
}

/**
 * 配置文件管理器
 */
export class ProfileManager {
  private store: ProfilesStore;

  constructor() {
    this.store = loadProfilesStore();
  }

  /** 重新加载存储 */
  reload(): void {
    this.store = loadProfilesStore();
  }

  /** 列出所有配置文件 */
  list(): BrowserProfile[] {
    return Object.values(this.store.profiles);
  }

  /** 获取指定配置文件 */
  get(name: string): BrowserProfile | undefined {
    return this.store.profiles[name];
  }

  /** 获取默认配置文件 */
  getDefault(): BrowserProfile {
    // 先找 isDefault 的
    const defaultProfile = Object.values(this.store.profiles).find(p => p.isDefault);
    if (defaultProfile) return defaultProfile;

    // 找名为 "default" 的
    if (this.store.profiles["default"]) {
      return this.store.profiles["default"];
    }

    // 没有任何配置文件，创建默认的
    return this.create({ name: "default", isDefault: true });
  }

  /** 创建配置文件 */
  create(params: {
    name: string;
    color?: string;
    cdpPort?: number;
    isDefault?: boolean;
  }): BrowserProfile {
    const { name, color, isDefault } = params;

    if (!isValidProfileName(name)) {
      throw new Error(`Invalid profile name "${name}". Must match ${PROFILE_NAME_REGEX.toString()}`);
    }

    if (this.store.profiles[name]) {
      throw new Error(`Profile "${name}" already exists`);
    }

    // 分配端口
    const usedPorts = new Set(Object.values(this.store.profiles).map(p => p.cdpPort));
    const cdpPort = params.cdpPort ?? allocateCdpPort(usedPorts);
    if (!cdpPort) {
      throw new Error("No available CDP ports");
    }

    // 分配颜色
    const usedColors = new Set(Object.values(this.store.profiles).map(p => p.color).filter(Boolean) as string[]);
    const profileColor = color ?? allocateColor(usedColors);

    // 创建用户数据目录
    const userDataDir = getProfileDataDir(name);
    mkdirSync(userDataDir, { recursive: true });

    const profile: BrowserProfile = {
      name,
      cdpPort,
      userDataDir,
      color: profileColor,
      isDefault: isDefault ?? false,
      createdAt: Date.now(),
    };

    // 如果设为默认，清除其他默认标记
    if (isDefault) {
      for (const p of Object.values(this.store.profiles)) {
        p.isDefault = false;
      }
    }

    this.store.profiles[name] = profile;
    saveProfilesStore(this.store);

    return profile;
  }

  /** 删除配置文件 */
  delete(name: string): boolean {
    const profile = this.store.profiles[name];
    if (!profile) return false;

    // 删除用户数据目录
    const dataDir = getProfileDataDir(name);
    if (existsSync(dataDir)) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // 忽略删除失败
      }
    }

    delete this.store.profiles[name];
    saveProfilesStore(this.store);

    return true;
  }

  /** 设置默认配置文件 */
  setDefault(name: string): boolean {
    const profile = this.store.profiles[name];
    if (!profile) return false;

    for (const p of Object.values(this.store.profiles)) {
      p.isDefault = p.name === name;
    }

    saveProfilesStore(this.store);
    return true;
  }

  /** 重置配置文件数据 */
  reset(name: string): boolean {
    const profile = this.store.profiles[name];
    if (!profile) return false;

    const dataDir = getProfileDataDir(name);
    if (existsSync(dataDir)) {
      // 移动到回收站目录
      const trashDir = join(BROWSER_DATA_DIR, "trash");
      mkdirSync(trashDir, { recursive: true });
      const trashPath = join(trashDir, `${name}-${Date.now()}`);
      try {
        renameSync(dataDir, trashPath);
      } catch {
        rmSync(dataDir, { recursive: true, force: true });
      }
    }

    // 重新创建空目录
    mkdirSync(dataDir, { recursive: true });
    return true;
  }
}
