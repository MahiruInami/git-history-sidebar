export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  filePath: string;
  commitHash?: string;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, metadata: { filePath: string; commitHash?: string }): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      filePath: metadata.filePath,
      commitHash: metadata.commitHash
    });
  }

  invalidate(filePath?: string): void {
    if (filePath) {
      for (const [key, entry] of this.cache.entries()) {
        if (entry.filePath === filePath) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
