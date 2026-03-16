/**
 * Memory System - Mozi Memory Module
 * Refactored based on moltbot architecture with SQLite backend and hybrid search
 */

// Core types and interfaces
export type {
  MemoryEntry,
  MemoryStore,
  EmbeddingProvider,
  MemorySource,
  MemorySearchResult,
  MemoryProviderStatus,
  MemorySyncProgressUpdate,
  MemoryEmbeddingProbeResult,
  MemoryListFilter,
  MemoryStoreStatus,
  MemorySearchOptions,
  HybridSearchConfig,
  MemoryConfig,
  MemoryManagerConfig,
} from "./types.js";

// Core interfaces
export { MemorySearchManager } from "./manager.js";

// Storage implementations
export { SqliteMemoryStore, JsonMemoryStore } from "./store.js";
export type { MemoryChunk } from "./store.js";

// Embedding providers
export {
  SimpleEmbedding,
  ProviderEmbedding,
  APIEmbedding,
  createEmbeddingProvider,
  EmbeddingCache,
  BatchEmbedding,
} from "./embeddings.js";

// Legacy Memory Manager (backward compatible)
export { MemoryManager, createMemoryManager, createMemorySearchManager } from "./manager.js";

// Re-export utilities
export { cosineSimilarity, chunkText, hashText } from "./store.js";
