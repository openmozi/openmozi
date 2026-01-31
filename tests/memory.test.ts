/**
 * Memory 系统测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock providers
vi.mock("../src/providers/index.js", () => ({
  getProvider: () => null,
  findProviderForModel: () => null,
}));

import {
  MemoryManager,
  createMemoryManager,
  JsonMemoryStore,
  type MemoryEntry,
} from "../src/memory/index.js";

describe("memory/index", () => {
  const testDir = path.join(os.tmpdir(), `mozi-test-${Date.now()}`);

  beforeEach(() => {
    // 确保测试目录存在
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("JsonMemoryStore", () => {
    it("should create store and add entries", async () => {
      const store = new JsonMemoryStore(testDir);

      const id = await store.add({
        content: "Test memory content",
        metadata: {
          type: "note",
          timestamp: Date.now(),
        },
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });

    it("should retrieve entry by id", async () => {
      const store = new JsonMemoryStore(testDir);

      const id = await store.add({
        content: "Retrievable content",
        metadata: {
          type: "fact",
          timestamp: Date.now(),
          tags: ["test"],
        },
      });

      const entry = await store.get(id);
      expect(entry).toBeDefined();
      expect(entry?.content).toBe("Retrievable content");
      expect(entry?.metadata.type).toBe("fact");
      expect(entry?.metadata.tags).toContain("test");
    });

    it("should return undefined for non-existent id", async () => {
      const store = new JsonMemoryStore(testDir);
      const entry = await store.get("non-existent-id");
      expect(entry).toBeUndefined();
    });

    it("should delete entry", async () => {
      const store = new JsonMemoryStore(testDir);

      const id = await store.add({
        content: "To be deleted",
        metadata: { type: "note", timestamp: Date.now() },
      });

      const deleted = await store.delete(id);
      expect(deleted).toBe(true);

      const entry = await store.get(id);
      expect(entry).toBeUndefined();
    });

    it("should return false when deleting non-existent entry", async () => {
      const store = new JsonMemoryStore(testDir);
      const deleted = await store.delete("non-existent");
      expect(deleted).toBe(false);
    });

    it("should list entries with filtering", async () => {
      const store = new JsonMemoryStore(testDir);

      await store.add({
        content: "Fact 1",
        metadata: { type: "fact", timestamp: Date.now(), tags: ["tag1"] },
      });

      await store.add({
        content: "Note 1",
        metadata: { type: "note", timestamp: Date.now(), tags: ["tag2"] },
      });

      await store.add({
        content: "Fact 2",
        metadata: { type: "fact", timestamp: Date.now(), tags: ["tag1", "tag2"] },
      });

      // List all
      const all = await store.list();
      expect(all.length).toBe(3);

      // Filter by type
      const facts = await store.list({ type: "fact" });
      expect(facts.length).toBe(2);

      // Filter by tag
      const tag1 = await store.list({ tags: ["tag1"] });
      expect(tag1.length).toBe(2);

      const tag2 = await store.list({ tags: ["tag2"] });
      expect(tag2.length).toBe(2);
    });

    it("should search entries by content similarity", async () => {
      const store = new JsonMemoryStore(testDir);

      await store.add({
        content: "The weather is sunny today",
        metadata: { type: "note", timestamp: Date.now() },
      });

      await store.add({
        content: "I love programming in TypeScript",
        metadata: { type: "note", timestamp: Date.now() },
      });

      await store.add({
        content: "The sun is shining bright",
        metadata: { type: "note", timestamp: Date.now() },
      });

      // Search for weather-related content
      const results = await store.search("sunny weather", 2);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.score).toBeDefined();
    });

    it("should clear all entries", async () => {
      const store = new JsonMemoryStore(testDir);

      await store.add({
        content: "Entry 1",
        metadata: { type: "note", timestamp: Date.now() },
      });

      await store.add({
        content: "Entry 2",
        metadata: { type: "note", timestamp: Date.now() },
      });

      await store.clear();

      const all = await store.list();
      expect(all.length).toBe(0);
    });
  });

  describe("MemoryManager", () => {
    it("should create manager with default config", () => {
      const manager = new MemoryManager({ directory: testDir });
      expect(manager).toBeDefined();
    });

    it("should use createMemoryManager factory", () => {
      const manager = createMemoryManager({ directory: testDir });
      expect(manager).toBeDefined();
    });

    it("should remember and recall content", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });

      const id = await manager.remember("Important fact to remember", {
        type: "fact",
        tags: ["important"],
      });

      expect(id).toBeDefined();

      const results = await manager.recall("important fact", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should get memory by id", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });

      const id = await manager.remember("Specific memory", { type: "note" });

      const entry = await manager.get(id!);
      expect(entry).toBeDefined();
      expect(entry?.content).toBe("Specific memory");
    });

    it("should forget memory by id", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });

      const id = await manager.remember("To forget", { type: "note" });

      const deleted = await manager.forget(id!);
      expect(deleted).toBe(true);

      const entry = await manager.get(id!);
      expect(entry).toBeUndefined();
    });

    it("should list memories with filter", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });

      await manager.remember("Code snippet", { type: "code" });
      await manager.remember("Random note", { type: "note" });

      const code = await manager.list({ type: "code" });
      expect(code.length).toBe(1);
      expect(code[0]?.metadata.type).toBe("code");
    });

    it("should return empty results when disabled", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: false });

      const id = await manager.remember("This won't be saved", { type: "note" });
      expect(id).toBeNull();

      const results = await manager.recall("anything", 5);
      expect(results).toEqual([]);
    });

    it("should format memories for context", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });

      const entries: MemoryEntry[] = [
        {
          id: "1",
          content: "First memory",
          metadata: { type: "fact", timestamp: Date.now() },
          score: 0.95,
        },
        {
          id: "2",
          content: "Second memory",
          metadata: { type: "note", timestamp: Date.now() },
          score: 0.8,
        },
      ];

      const formatted = manager.formatForContext(entries);
      expect(formatted).toContain("Relevant Memories");
      expect(formatted).toContain("First memory");
      expect(formatted).toContain("Second memory");
      expect(formatted).toContain("95%"); // score formatted
    });

    it("should return empty string for empty entries", async () => {
      const manager = new MemoryManager({ directory: testDir, enabled: true });
      const formatted = manager.formatForContext([]);
      expect(formatted).toBe("");
    });
  });

  describe("Memory persistence", () => {
    it("should persist entries across store instances", async () => {
      // Create first store and add entry
      const store1 = new JsonMemoryStore(testDir);
      const id = await store1.add({
        content: "Persistent content",
        metadata: { type: "note", timestamp: Date.now() },
      });

      // Create second store instance
      const store2 = new JsonMemoryStore(testDir);
      const entry = await store2.get(id);

      expect(entry).toBeDefined();
      expect(entry?.content).toBe("Persistent content");
    });
  });
});
