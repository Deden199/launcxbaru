export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cacheMap = new Map<string, CacheEntry<any>>();

export function getCache<T>(key: string): T | undefined {
  const entry = cacheMap.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cacheMap.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  cacheMap.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function deleteCache(key: string): void {
  cacheMap.delete(key);
}
