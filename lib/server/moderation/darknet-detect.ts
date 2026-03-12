/**
 * Darknet, covert communication, and encoded content detection.
 * Runs entirely locally — zero API calls.
 *
 * Detects:
 * - .onion / Tor hidden service links
 * - Darknet market language and patterns
 * - I2P / Freenet / ZeroNet links
 * - PGP encrypted blocks (used for covert key/message exchange)
 * - Base64-encoded payloads embedded in posts
 * - Hex-encoded strings (used to hide URLs/content)
 * - Cryptocurrency wallet addresses in suspicious context
 * - Dead-drop / paste-site communication patterns
 * - Steganography references
 */

import type { SafetyDecision } from "@/lib/server/moderation/store";

export type DarknetScanResult = {
  decision: SafetyDecision;
  labels: string[];
  reasons: string[];
};

// ── .onion and hidden-service detection ─────────────────────────────

// Tor .onion addresses (v2: 16 chars, v3: 56 chars)
const ONION_V2 = /\b[a-z2-7]{16}\.onion\b/i;
const ONION_V3 = /\b[a-z2-7]{56}\.onion\b/i;
const ONION_URL = /https?:\/\/[a-z2-7]{10,56}\.onion\b/i;
const ONION_MENTION = /\.onion\b/i;

// I2P eepsites
const I2P_LINK = /\b[a-z0-9]+\.i2p\b/i;
const I2P_B32 = /\b[a-z2-7]{52}\.b32\.i2p\b/i;

// Freenet / ZeroNet
const FREENET_KEY = /\bUSK@[A-Za-z0-9~_-]+/;
const ZERONET_ADDR = /\b1[A-HJ-NP-Za-km-z]{25,34}\.bit\b/;

// ── Darknet marketplace / operations language ───────────────────────

const DARKNET_MARKET_PATTERNS = [
  // Market-specific terms
  /\b(?:dark\s*(?:net|web))\s*(?:market|vendor|shop|store|listing)/i,
  /\b(?:market|vendor|shop)\s*(?:on|at|via)\s*(?:dark\s*(?:net|web)|tor|onion)/i,
  /\b(?:dead\s*drop|dead\s*letter|brush\s*pass)\b/i,
  /\b(?:escrow|multisig|finalize\s*early|fe\s*only)\b.{0,20}(?:vendor|market|order)/i,

  // Operational security language
  /\b(?:opsec|op\s*sec|operational\s*security)\b.{0,30}(?:guide|tip|rule)/i,
  /\btails\s*(?:os|usb|boot)/i,
  /\b(?:pgp|gpg)\s*(?:key|encrypt|public\s*key|fingerprint)\b.{0,20}(?:vendor|market|contact)/i,
  /\btor\s*(?:browser|network|hidden|relay|bridge|exit\s*node)/i,

  // Darknet drug-market slang
  /\b(?:stealth\s*(?:ship|pack|delivery|postage))\b/i,
  /\b(?:vacuum\s*seal|mylar\s*bag|smell\s*proof)\b/i,
  /\b(?:domestic|international)\s*(?:ship|delivery|post)\b.{0,20}(?:vendor|order|pack)/i,

  // Darknet weapons
  /\b(?:buy|order|purchase)\b.{0,20}\b(?:gun|weapon|firearm)\b.{0,20}\b(?:dark\s*(?:net|web)|onion|tor)\b/i,

  // Hitmen / murder-for-hire (unfortunately real on darknet)
  /\b(?:hit\s*man|hitman|murder\s*(?:for|4)\s*hire|contract\s*kill)\b/i,

  // Counterfeit
  /\b(?:counterfeit|supernote|super\s*bill)\b.{0,20}(?:usd|dollar|euro|pound|money|bill|note)/i,
];

// ── Paste-site / dead-drop communication ────────────────────────────

const PASTE_SITE_PATTERNS = [
  /\b(?:pastebin|ghostbin|rentry|privatebin|hastebin|dpaste|paste\.ee|justpaste)\b.{0,10}(?:\.com|\.org|\.io|\/)/i,
  /\b(?:anonpaste|0bin|zerobin|cryptobin)\b/i,
  // Signal users to check external dead-drops
  /\b(?:check|see|visit|go\s*to)\s*(?:my|the)\s*(?:paste|bin|link|drop)\b/i,
];

// ── PGP / encrypted blocks ──────────────────────────────────────────

// Full PGP message block
const PGP_MESSAGE = /-----BEGIN PGP MESSAGE-----[\s\S]{20,}-----END PGP MESSAGE-----/;
const PGP_PUBLIC_KEY = /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]{20,}-----END PGP PUBLIC KEY BLOCK-----/;
const PGP_SIGNED = /-----BEGIN PGP SIGNED MESSAGE-----/;

// PGP fingerprints (40 hex chars in groups of 4)
const PGP_FINGERPRINT = /\b[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\s+[0-9A-F]{4}\b/;

// ── Base64 encoded payloads ─────────────────────────────────────────

// Long base64 strings (likely embedded data, not normal chat)
// Must be at least 80 chars to avoid false positives on short tokens
const BASE64_PAYLOAD = /(?:^|\s)[A-Za-z0-9+/]{80,}={0,2}(?:\s|$)/;

// Data URIs embedded in text (not in img tags, suspicious in posts)
const DATA_URI_IN_TEXT = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]{40,}/i;

// ── Hex-encoded content ─────────────────────────────────────────────

// Long hex strings (likely encoded URLs/data)
const HEX_PAYLOAD = /\b(?:0x)?[0-9a-f]{64,}\b/i;
// Hex that looks like it encodes ASCII text (pairs of 2x-7x hex digits)
const HEX_ASCII = /(?:[2-7][0-9a-f]){20,}/i;

// ── Cryptocurrency in suspicious context ────────────────────────────

const CRYPTO_PAYMENT_PATTERNS = [
  // BTC/XMR addresses with market/purchase context
  /\b(?:send|pay|transfer|deposit)\b.{0,20}\b(?:btc|bitcoin|xmr|monero|ltc|litecoin)\b.{0,20}\b(?:address|wallet)\b/i,
  // Monero (preferred darknet currency) address pattern
  /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/, // Monero address
  // Explicit payment instructions
  /\b(?:payment|pay)\s*(?:to|:)\s*(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,}/i,
  // Mixing / tumbling
  /\b(?:bitcoin|btc|crypto)\s*(?:mixer|tumbler|mixing|tumbling|launder)/i,
];

// ── Steganography ───────────────────────────────────────────────────

const STEGO_PATTERNS = [
  /\bstegan(?:o|ography)\b/i,
  /\bhidden\s*(?:message|data|payload)\s*(?:in|inside|within)\s*(?:image|photo|picture|file)/i,
  /\b(?:embed|hide|conceal)\s*(?:data|message|text|payload)\s*(?:in|inside|within)\s*(?:image|photo|picture|jpg|png)/i,
  /\b(?:steghide|openstego|stegsolve|zsteg|stegcracker)\b/i,
];

// ── Main scanner ────────────────────────────────────────────────────

export function scanForDarknetContent(text: string): DarknetScanResult {
  const labels = new Set<string>();
  const reasons: string[] = [];

  // --- Onion / hidden services ---
  if (ONION_URL.test(text) || ONION_V2.test(text) || ONION_V3.test(text)) {
    labels.add("onion-link");
    labels.add("darknet");
    reasons.push("Contains Tor .onion hidden service URL");
  } else if (ONION_MENTION.test(text)) {
    labels.add("onion-reference");
    reasons.push("References .onion domains");
  }

  // --- I2P / Freenet / ZeroNet ---
  if (I2P_LINK.test(text) || I2P_B32.test(text)) {
    labels.add("i2p-link");
    labels.add("darknet");
    reasons.push("Contains I2P anonymous network link");
  }
  if (FREENET_KEY.test(text)) {
    labels.add("freenet-key");
    labels.add("darknet");
    reasons.push("Contains Freenet content key");
  }
  if (ZERONET_ADDR.test(text)) {
    labels.add("zeronet");
    labels.add("darknet");
    reasons.push("Contains ZeroNet address");
  }

  // --- Darknet market language ---
  for (const pattern of DARKNET_MARKET_PATTERNS) {
    if (pattern.test(text)) {
      labels.add("darknet-market");
      labels.add("illegal_content");
      reasons.push("Matches darknet marketplace or illegal services language");
      break;
    }
  }

  // --- Paste-site dead-drops ---
  for (const pattern of PASTE_SITE_PATTERNS) {
    if (pattern.test(text)) {
      labels.add("paste-site");
      reasons.push("References paste/dead-drop site for covert communication");
      break;
    }
  }

  // --- PGP encrypted content ---
  if (PGP_MESSAGE.test(text)) {
    labels.add("pgp-message");
    labels.add("encrypted-content");
    reasons.push("Contains PGP encrypted message block");
  }
  if (PGP_PUBLIC_KEY.test(text)) {
    labels.add("pgp-key");
    reasons.push("Contains PGP public key block");
  }
  if (PGP_SIGNED.test(text)) {
    labels.add("pgp-signed");
    reasons.push("Contains PGP signed message");
  }
  if (PGP_FINGERPRINT.test(text)) {
    labels.add("pgp-fingerprint");
    reasons.push("Contains PGP key fingerprint");
  }

  // --- Base64 encoded payloads ---
  if (BASE64_PAYLOAD.test(text)) {
    labels.add("base64-payload");
    labels.add("encoded-content");
    reasons.push("Contains suspicious base64-encoded payload");
  }
  if (DATA_URI_IN_TEXT.test(text)) {
    labels.add("data-uri");
    labels.add("encoded-content");
    reasons.push("Contains embedded data URI (possible hidden content)");
  }

  // --- Hex encoded content ---
  if (HEX_PAYLOAD.test(text) || HEX_ASCII.test(text)) {
    // Don't flag Ethereum addresses (42 hex chars starting with 0x) — those are normal
    const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(text.trim());
    if (!isEthAddress) {
      labels.add("hex-encoded");
      labels.add("encoded-content");
      reasons.push("Contains suspicious hex-encoded content");
    }
  }

  // --- Crypto in suspicious context ---
  for (const pattern of CRYPTO_PAYMENT_PATTERNS) {
    if (pattern.test(text)) {
      labels.add("crypto-payment");
      reasons.push("Contains cryptocurrency payment instruction in suspicious context");
      break;
    }
  }

  // --- Steganography ---
  for (const pattern of STEGO_PATTERNS) {
    if (pattern.test(text)) {
      labels.add("steganography");
      reasons.push("References steganography or hidden data in images");
      break;
    }
  }

  // --- Decision logic ---
  // Hard block: actual darknet links, encrypted communication blocks, illegal market language
  const hardBlock =
    labels.has("onion-link") ||
    labels.has("i2p-link") ||
    labels.has("freenet-key") ||
    labels.has("zeronet") ||
    labels.has("pgp-message") ||
    labels.has("illegal_content");

  // Review: references/signals that need human judgment
  const needsReview =
    labels.has("onion-reference") ||
    labels.has("darknet-market") ||
    labels.has("paste-site") ||
    labels.has("pgp-key") ||
    labels.has("pgp-fingerprint") ||
    labels.has("base64-payload") ||
    labels.has("encoded-content") ||
    labels.has("crypto-payment") ||
    labels.has("steganography");

  let decision: SafetyDecision = "allow";
  if (hardBlock) decision = "block";
  else if (needsReview) decision = "review";

  return {
    decision,
    labels: Array.from(labels),
    reasons: [...new Set(reasons)],
  };
}
