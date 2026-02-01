/**
 * 浏览器模块测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ProfileManager,
  isValidProfileName,
  allocateCdpPort,
  allocateColor,
} from "../src/browser/profiles.js";
import {
  parseAriaSnapshot,
  generateRefSnapshot,
} from "../src/browser/session.js";
import type { RefMap, BrowserProfile } from "../src/browser/types.js";
import { CDP_PORT_RANGE_START, PROFILE_COLORS } from "../src/browser/types.js";

// Mock fs 模块
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{"version":1,"profiles":{}}'),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

describe("browser/profiles", () => {
  describe("isValidProfileName", () => {
    it("should accept valid profile names", () => {
      expect(isValidProfileName("default")).toBe(true);
      expect(isValidProfileName("my-profile")).toBe(true);
      expect(isValidProfileName("test123")).toBe(true);
      expect(isValidProfileName("a")).toBe(true);
    });

    it("should reject invalid profile names", () => {
      expect(isValidProfileName("")).toBe(false);
      expect(isValidProfileName("-invalid")).toBe(false);
      expect(isValidProfileName("Invalid")).toBe(false);
      expect(isValidProfileName("has space")).toBe(false);
      expect(isValidProfileName("has_underscore")).toBe(false);
      expect(isValidProfileName("a".repeat(33))).toBe(false);
    });
  });

  describe("allocateCdpPort", () => {
    it("should allocate first available port", () => {
      const usedPorts = new Set<number>();
      const port = allocateCdpPort(usedPorts);
      expect(port).toBe(CDP_PORT_RANGE_START);
    });

    it("should skip used ports", () => {
      const usedPorts = new Set([CDP_PORT_RANGE_START, CDP_PORT_RANGE_START + 1]);
      const port = allocateCdpPort(usedPorts);
      expect(port).toBe(CDP_PORT_RANGE_START + 2);
    });

    it("should return null when all ports are used", () => {
      const usedPorts = new Set<number>();
      for (let i = CDP_PORT_RANGE_START; i <= CDP_PORT_RANGE_START + 99; i++) {
        usedPorts.add(i);
      }
      const port = allocateCdpPort(usedPorts);
      expect(port).toBe(null);
    });
  });

  describe("allocateColor", () => {
    it("should allocate first available color", () => {
      const usedColors = new Set<string>();
      const color = allocateColor(usedColors);
      expect(color).toBe(PROFILE_COLORS[0]);
    });

    it("should skip used colors", () => {
      const usedColors = new Set([PROFILE_COLORS[0]!]);
      const color = allocateColor(usedColors);
      expect(color).toBe(PROFILE_COLORS[1]);
    });

    it("should wrap around when all colors are used", () => {
      const usedColors = new Set(PROFILE_COLORS);
      const color = allocateColor(usedColors);
      expect(color).toBe(PROFILE_COLORS[0]);
    });
  });
});

describe("browser/session", () => {
  describe("parseAriaSnapshot", () => {
    it("should parse aria snapshot and generate refs", () => {
      const snapshot = `
- banner
  - heading "Welcome"
  - button "Sign In"
  - link "Learn More"
- main
  - textbox "Email"
  - textbox "Password"
  - checkbox "Remember me"
`;
      const refs = parseAriaSnapshot(snapshot);

      expect(refs.size).toBe(5);
      expect(refs.get("e1")).toEqual({ role: "button", name: "Sign In", nth: undefined });
      expect(refs.get("e2")).toEqual({ role: "link", name: "Learn More", nth: undefined });
      expect(refs.get("e3")).toEqual({ role: "textbox", name: "Email", nth: undefined });
      // Password 是第二个同名 textbox，但名称不同所以 nth 为 undefined
      expect(refs.get("e4")).toEqual({ role: "textbox", name: "Password", nth: undefined });
      expect(refs.get("e5")).toEqual({ role: "checkbox", name: "Remember me", nth: undefined });
    });

    it("should only generate refs for interactive elements", () => {
      const snapshot = `
- banner
  - heading "Title"
  - paragraph "Some text"
  - button "Click me"
`;
      const refs = parseAriaSnapshot(snapshot);

      expect(refs.size).toBe(1);
      expect(refs.get("e1")).toEqual({ role: "button", name: "Click me", nth: undefined });
    });

    it("should handle elements without names", () => {
      const snapshot = `
- main
  - button
  - textbox
`;
      const refs = parseAriaSnapshot(snapshot);

      expect(refs.size).toBe(2);
      expect(refs.get("e1")).toEqual({ role: "button", name: undefined, nth: undefined });
      expect(refs.get("e2")).toEqual({ role: "textbox", name: undefined, nth: undefined });
    });
  });

  describe("generateRefSnapshot", () => {
    it("should generate readable snapshot text", () => {
      const refs: RefMap = new Map([
        ["e1", { role: "button", name: "Submit" }],
        ["e2", { role: "textbox", name: "Email" }],
        ["e3", { role: "checkbox", name: "Agree", nth: 2 }],
      ]);

      const text = generateRefSnapshot(refs);

      expect(text).toContain('[e1] button "Submit"');
      expect(text).toContain('[e2] textbox "Email"');
      expect(text).toContain('[e3] checkbox "Agree" [2]');
    });
  });
});
