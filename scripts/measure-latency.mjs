#!/usr/bin/env node
/**
 * Latency profiler — hits every API endpoint the feed page calls on mount
 * and measures real wall-clock time for each.
 *
 * Usage:
 *   node scripts/measure-latency.mjs [baseUrl]
 *
 * Default base: http://localhost:3000
 */

const BASE = process.argv[2] || "http://localhost:3000";

// ── helpers ─────────────────────────────────────────────────────────

async function measure(label, fn) {
  const start = performance.now();
  let result, error;
  try {
    result = await fn();
  } catch (e) {
    error = e;
  }
  const ms = performance.now() - start;
  return { label, ms: Math.round(ms), result, error };
}

async function fetchJson(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// ── measurements ────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔬  Latency profiler — ${BASE}\n`);
  console.log("=".repeat(70));

  // 1. Feed endpoint (the big one) — with server-side timing breakdown
  const feed = await measure(
    "GET /api/posts?source=lens&limit=10&timing=1",
    () => fetchJson("/api/posts?source=lens&limit=10&timing=1")
  );
  printResult(feed);
  if (feed.result?.body?.timings) {
    console.log("   Server-side breakdown:");
    const t = feed.result.body.timings;
    for (const [k, v] of Object.entries(t)) {
      console.log(`     ${k.padEnd(30)} ${String(v).padStart(6)}ms`);
    }
  }
  console.log();

  // 2. Feed (cold, no cache — second call within 10s should be cached)
  const feed2 = await measure(
    "GET /api/posts (2nd call, warm cache?)",
    () => fetchJson("/api/posts?source=lens&limit=10&timing=1")
  );
  printResult(feed2);
  console.log();

  // 3. Settings endpoint
  const settings = await measure(
    "GET /api/settings",
    () => fetchJson("/api/settings")
  );
  printResult(settings);
  console.log();

  // 4. Lens session check
  const session = await measure(
    "GET /api/lens/session",
    () => fetchJson("/api/lens/session")
  );
  printResult(session);
  console.log();

  // 5. Health
  const health = await measure(
    "GET /api/health",
    () => fetchJson("/api/health")
  );
  printResult(health);
  console.log();

  // 6. Notifications
  const notif = await measure(
    "GET /api/notifications",
    () => fetchJson("/api/notifications")
  );
  printResult(notif);
  console.log();

  // 7. Bookmarks
  const bookmarks = await measure(
    "GET /api/bookmarks",
    () => fetchJson("/api/bookmarks")
  );
  printResult(bookmarks);
  console.log();

  // 8. Lists
  const lists = await measure(
    "GET /api/lists",
    () => fetchJson("/api/lists")
  );
  printResult(lists);
  console.log();

  // 9. Messages
  const messages = await measure(
    "GET /api/messages",
    () => fetchJson("/api/messages")
  );
  printResult(messages);
  console.log();

  // 10. Simulate full page-load waterfall (what the browser actually does)
  console.log("=".repeat(70));
  console.log("📊  SIMULATED PAGE LOAD (parallel API calls):\n");

  const pageStart = performance.now();
  const parallel = await Promise.all([
    measure("  feed", () => fetchJson("/api/posts?source=lens&limit=10&timing=1")),
    measure("  settings", () => fetchJson("/api/settings")),
    measure("  session", () => fetchJson("/api/lens/session")),
    measure("  notifications", () => fetchJson("/api/notifications")),
    measure("  bookmarks", () => fetchJson("/api/bookmarks")),
  ]);
  const pageMs = Math.round(performance.now() - pageStart);

  for (const r of parallel.sort((a, b) => b.ms - a.ms)) {
    printResult(r);
  }
  console.log(`\n  Total wall-clock (parallel): ${pageMs}ms`);
  console.log(`  Slowest single call:         ${Math.max(...parallel.map((r) => r.ms))}ms`);

  // Print feed server timings if available
  const feedResult = parallel.find((r) => r.label.includes("feed"));
  if (feedResult?.result?.body?.timings) {
    console.log("\n  Feed server-side breakdown:");
    for (const [k, v] of Object.entries(feedResult.result.body.timings)) {
      console.log(`     ${k.padEnd(30)} ${String(v).padStart(6)}ms`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Done.\n");
}

function printResult(r) {
  const status = r.error
    ? `❌ ${r.error.message?.slice(0, 50)}`
    : `${r.result?.status ?? "?"}`;
  const bar = "█".repeat(Math.min(Math.round(r.ms / 100), 40));
  console.log(
    `  ${r.label.padEnd(45)} ${String(r.ms).padStart(6)}ms  [${status}]  ${bar}`
  );
}

run().catch(console.error);
