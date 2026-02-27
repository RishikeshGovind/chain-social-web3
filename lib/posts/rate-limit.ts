//lib/posts/rate-limit.ts

const POST_COOLDOWN_MS = 10_000;
const POSTS_PER_MINUTE = 12;
const REPLY_COOLDOWN_MS = 1_500;
const REPLIES_PER_MINUTE = 40;

const postRateState = new Map<string, { lastPostAt: number; windowStart: number; count: number }>();
const replyRateState = new Map<string, { lastReplyAt: number; windowStart: number; count: number }>();

export function checkPostRateLimit(address: string) {
  const now = Date.now();
  const state = postRateState.get(address) ?? {
    lastPostAt: 0,
    windowStart: now,
    count: 0,
  };

  if (now - state.lastPostAt < POST_COOLDOWN_MS) {
    return {
      ok: false as const,
      error: "Posting too quickly. Please wait a few seconds.",
      retryAfterMs: POST_COOLDOWN_MS - (now - state.lastPostAt),
    };
  }

  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }

  if (state.count >= POSTS_PER_MINUTE) {
    return {
      ok: false as const,
      error: "Rate limit reached. Try again in a minute.",
      retryAfterMs: 60_000 - (now - state.windowStart),
    };
  }

  state.count += 1;
  state.lastPostAt = now;
  postRateState.set(address, state);

  return { ok: true as const };
}

export function checkReplyRateLimit(address: string) {
  const now = Date.now();
  const state = replyRateState.get(address) ?? {
    lastReplyAt: 0,
    windowStart: now,
    count: 0,
  };

  if (now - state.lastReplyAt < REPLY_COOLDOWN_MS) {
    return {
      ok: false as const,
      error: "Replying too quickly. Please wait a moment.",
      retryAfterMs: REPLY_COOLDOWN_MS - (now - state.lastReplyAt),
    };
  }

  if (now - state.windowStart >= 60_000) {
    state.windowStart = now;
    state.count = 0;
  }

  if (state.count >= REPLIES_PER_MINUTE) {
    return {
      ok: false as const,
      error: "Reply rate limit reached. Try again in a minute.",
      retryAfterMs: 60_000 - (now - state.windowStart),
    };
  }

  state.count += 1;
  state.lastReplyAt = now;
  replyRateState.set(address, state);

  return { ok: true as const };
}
