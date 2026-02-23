/**
 * Simple request deduplication cache to prevent duplicate fetch calls.
 * Useful for API requests that might be triggered multiple times in quick succession.
 */

type RequestKey = string;
type PendingRequest<T> = {
  promise: Promise<T>;
  timestamp: number;
};

const pendingRequests = new Map<RequestKey, PendingRequest<unknown>>();
const CACHE_TTL = 60000; // 60 seconds

/**
 * Deduplicate identical requests within a time window.
 * If the same request is made while one is pending, return the existing promise.
 * 
 * @param key Unique identifier for the request (usually URL + params)
 * @param fn Async function that makes the actual request
 * @returns Promise that resolves to the request result
 */
export async function deduplicatedRequest<T>(
  key: RequestKey,
  fn: () => Promise<T>
): Promise<T> {
  const existing = pendingRequests.get(key);

  // If request is still pending, reuse it
  if (existing) {
    const age = Date.now() - existing.timestamp;
    if (age < CACHE_TTL) {
      return existing.promise as Promise<T>;
    } else {
      // Expired, remove from map
      pendingRequests.delete(key);
    }
  }

  // Make new request
  const promise = fn();
  pendingRequests.set(key, { promise, timestamp: Date.now() });

  // Clean up after completion
  promise
    .then(() => {
      // Keep in cache for a bit for reuse within TTL
      setTimeout(() => pendingRequests.delete(key), CACHE_TTL);
    })
    .catch(() => {
      // Remove failed requests immediately
      pendingRequests.delete(key);
    });

  return promise;
}

/**
 * Clear all cached requests
 */
export function clearDeduplicationCache() {
  pendingRequests.clear();
}
