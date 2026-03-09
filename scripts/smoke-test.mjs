const baseUrl = (process.env.CHAINSOCIAL_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

const checks = [
  { path: "/api/health", expectJson: true },
  { path: "/" },
  { path: "/feed" },
  { path: "/explore" },
  { path: "/bookmarks" },
  { path: "/notifications" },
  { path: "/messages" },
  { path: "/settings" },
];

async function main() {
  let failed = false;

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: check.expectJson ? { Accept: "application/json" } : undefined,
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        failed = true;
        console.error(`FAIL ${check.path} -> ${response.status} (${latencyMs}ms)`);
        continue;
      }

      if (check.expectJson) {
        const payload = await response.json();
        if (payload?.status === "fail") {
          failed = true;
          console.error(`FAIL ${check.path} -> health reported fail (${latencyMs}ms)`);
          continue;
        }
      } else {
        await response.text();
      }

      console.log(`OK   ${check.path} (${latencyMs}ms)`);
    } catch (error) {
      failed = true;
      console.error(
        `FAIL ${check.path} -> ${error instanceof Error ? error.message : "request failed"}`
      );
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

void main();
