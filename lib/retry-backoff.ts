/**
 * Exponential backoff utility for API retries with configurable jitter
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Promise that resolves when function succeeds or max attempts reached
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't wait after last attempt
      if (attempt < config.maxAttempts - 1) {
        const delayMs = calculateBackoffDelay(
          attempt,
          config.initialDelayMs,
          config.maxDelayMs,
          config.backoffMultiplier,
          config.jitter
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('Retry failed: unknown error');
}

function calculateBackoffDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number,
  jitter: boolean
): number {
  const baseDelay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);
  
  if (!jitter) {
    return baseDelay;
  }

  // Add random jitter (±20% variance)
  const variance = baseDelay * 0.2;
  const jitterAmount = Math.random() * variance * 2 - variance;
  return Math.max(baseDelay + jitterAmount, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (e.g., network error, 5xx, 429)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network errors
    if (message.includes('econnrefused') || message.includes('enotfound') || message.includes('timeout')) {
      return true;
    }
    // HTTP status hints in message
    if (message.includes('5') || message.includes('429') || message.includes('rate')) {
      return true;
    }
  }
  return false;
}
