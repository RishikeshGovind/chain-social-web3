import { normalizeAddress } from "@/lib/posts/content";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

type RateLimitResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterMs: number };

type RateLimitPolicy = {
  keyPrefix: string;
  cooldownMs: number;
  perMinute: number;
  cooldownError: string;
  windowError: string;
};

type LocalState = { windowStart: number; count: number };
const localWindowState = new Map<string, LocalState>();

type UpstashResult = { result?: unknown };

function getUpstashConfig() {
  ensureRuntimeConfig();
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  const timeoutMs = Number.parseInt(process.env.CHAINSOCIAL_UPSTASH_TIMEOUT_MS ?? "2000", 10);
  return {
    url,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000,
  };
}

async function callUpstashPipeline(commands: unknown[][]) {
  const config = getUpstashConfig();
  if (!config) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Upstash request timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Upstash request failed with status ${response.status}`);
  }

  return (await response.json()) as UpstashResult[];
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function checkDistributedRateLimit(address: string, policy: RateLimitPolicy): Promise<RateLimitResult | null> {
  const normalized = normalizeAddress(address);
  const nowMinuteBucket = Math.floor(Date.now() / 60_000);
  const cooldownKey = `${policy.keyPrefix}:cooldown:${normalized}`;
  const minuteKey = `${policy.keyPrefix}:window:${normalized}:${nowMinuteBucket}`;
  const commands =
    policy.cooldownMs > 0
      ? [
          ["SET", cooldownKey, "1", "PX", String(policy.cooldownMs), "NX"],
          ["PTTL", cooldownKey],
          ["INCR", minuteKey],
          ["EXPIRE", minuteKey, "61", "NX"],
          ["PTTL", minuteKey],
        ]
      : [
          ["INCR", minuteKey],
          ["EXPIRE", minuteKey, "61", "NX"],
          ["PTTL", minuteKey],
        ];

  const results = await callUpstashPipeline(commands);

  if (!results) return null;

  if (policy.cooldownMs > 0 && results[0]?.result !== "OK") {
    return {
      ok: false,
      error: policy.cooldownError,
      retryAfterMs: Math.max(1, asNumber(results[1]?.result)),
    };
  }

  const minuteCount = asNumber(results[policy.cooldownMs > 0 ? 2 : 0]?.result);
  const minuteTtl = asNumber(results[policy.cooldownMs > 0 ? 4 : 2]?.result);

  if (minuteCount > policy.perMinute) {
    return {
      ok: false,
      error: policy.windowError,
      retryAfterMs: Math.max(1, minuteTtl),
    };
  }

  return { ok: true };
}

function checkLocalRateLimit(address: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  const normalized = normalizeAddress(address);

  const cooldownKey = `${policy.keyPrefix}:cooldown:${normalized}`;
  const cooldown = localWindowState.get(cooldownKey);
  if (cooldown && now - cooldown.windowStart < policy.cooldownMs) {
    return {
      ok: false,
      error: policy.cooldownError,
      retryAfterMs: policy.cooldownMs - (now - cooldown.windowStart),
    };
  }

  const windowKey = `${policy.keyPrefix}:window:${normalized}`;
  const state = localWindowState.get(windowKey) ?? { windowStart: now, count: 0 };

  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }

  if (state.count >= policy.perMinute) {
    return {
      ok: false,
      error: policy.windowError,
      retryAfterMs: 60_000 - (now - state.windowStart),
    };
  }

  state.count += 1;
  localWindowState.set(windowKey, state);
  localWindowState.set(cooldownKey, { windowStart: now, count: 1 });

  return { ok: true };
}

async function checkRateLimit(address: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const distributed = await checkDistributedRateLimit(address, policy).catch(() => null);
  if (distributed) return distributed;
  return checkLocalRateLimit(address, policy);
}

export async function checkPostRateLimit(address: string): Promise<RateLimitResult> {
  return checkRateLimit(address, {
    keyPrefix: "post",
    cooldownMs: 10_000,
    perMinute: 12,
    cooldownError: "Posting too quickly. Please wait a few seconds.",
    windowError: "Rate limit reached. Try again in a minute.",
  });
}

export async function checkReplyRateLimit(address: string): Promise<RateLimitResult> {
  return checkRateLimit(address, {
    keyPrefix: "reply",
    cooldownMs: 1_500,
    perMinute: 40,
    cooldownError: "Replying too quickly. Please wait a moment.",
    windowError: "Reply rate limit reached. Try again in a minute.",
  });
}

export async function checkUploadRateLimit(address: string): Promise<RateLimitResult> {
  return checkRateLimit(address, {
    keyPrefix: "upload",
    cooldownMs: 0,
    perMinute: 20,
    cooldownError: "Uploading too quickly. Please wait a moment.",
    windowError: "Upload rate limit reached. Please try again shortly.",
  });
}

export async function checkMessageRateLimit(address: string): Promise<RateLimitResult> {
  return checkRateLimit(address, {
    keyPrefix: "message",
    cooldownMs: 750,
    perMinute: 40,
    cooldownError: "Sending messages too quickly. Please wait a moment.",
    windowError: "Message rate limit reached. Try again in a minute.",
  });
}
