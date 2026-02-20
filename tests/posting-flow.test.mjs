import test from "node:test";
import assert from "node:assert/strict";

const content = await import("../.tmp-posting-tests/content.js");
const rateLimit = await import("../.tmp-posting-tests/rate-limit.js");
const authz = await import("../.tmp-posting-tests/authz.js");

test("sanitize content strips html and normalizes whitespace", () => {
  const result = content.sanitizePostContent("  <b>Hello</b>   world\n\n next   line ");
  assert.equal(result, "Hello world\n\nnext line");
});

test("content validation rejects empty and oversized content", () => {
  const empty = content.parseAndValidateContent("   ");
  assert.equal(empty.ok, false);

  const oversized = content.parseAndValidateContent("a".repeat(content.MAX_POST_LENGTH + 1));
  assert.equal(oversized.ok, false);
});

test("content validation accepts a normal post", () => {
  const valid = content.parseAndValidateContent("gm chain");
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.content, "gm chain");
  }
});

test("post rate limit applies cooldown", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  const first = rateLimit.checkPostRateLimit(address);
  assert.equal(first.ok, true);

  const second = rateLimit.checkPostRateLimit(address);
  assert.equal(second.ok, false);
});

test("authz only allows owner mutations", () => {
  const actor = "0x1234567890abcdef1234567890abcdef12345678";
  const owner = "0x1234567890abcdef1234567890abcdef12345678";
  const other = "0xfedcba0987654321fedcba0987654321fedcba09";

  assert.equal(authz.canMutateOwnedResource(actor, owner), true);
  assert.equal(authz.canMutateOwnedResource(actor, other), false);
});

test("authz blocks self-follow", () => {
  const actor = "0x1234567890abcdef1234567890abcdef12345678";
  const target = "0xfedcba0987654321fedcba0987654321fedcba09";

  assert.equal(authz.canToggleFollow(actor, target), true);
  assert.equal(authz.canToggleFollow(actor, actor), false);
});
