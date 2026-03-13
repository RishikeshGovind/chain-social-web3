/**
 * Local toxicity scoring engine — runs entirely in-process, zero API calls.
 *
 * Uses a curated weighted word/phrase list to produce a toxicity score.
 * Words are categorised by severity and context to reduce false positives.
 * The normalizeForModeration() pipeline should be applied BEFORE calling
 * these functions so leet-speak / homoglyph evasion is already handled.
 */

import type { SafetyDecision } from "@/lib/server/moderation/store";

export type ToxicityResult = {
  decision: SafetyDecision;
  score: number; // 0–1
  labels: string[];
  reasons: string[];
};

// ── Severity tiers ──────────────────────────────────────────────────
// Weight determines how much a single match contributes to the 0–1 score.
// CRITICAL = instant block, HIGH = strong signal, MEDIUM = review signal,
// LOW = spam/nuisance signal.

type SeverityTier = "critical" | "high" | "medium" | "low";

const TIER_WEIGHT: Record<SeverityTier, number> = {
  critical: 0.95,
  high: 0.45,
  medium: 0.25,
  low: 0.10,
};

type ToxicEntry = {
  pattern: RegExp;
  tier: SeverityTier;
  label: string;
  reason: string;
};

// ── Curated toxic content patterns ──────────────────────────────────
// These are tested against NORMALISED (lowercase, no leet, no homoglyphs) text.
// Patterns use word boundaries to reduce false positives.

const TOXIC_ENTRIES: ToxicEntry[] = [
  // ─── CRITICAL: Immediate block ───
  // CSAM / child exploitation
  { pattern: /\bchild\s*porn/i, tier: "critical", label: "csam", reason: "Child exploitation content" },
  { pattern: /\bkiddie\s*porn/i, tier: "critical", label: "csam", reason: "Child exploitation content" },
  { pattern: /\bpedo(?:phile|philia)?\b/i, tier: "critical", label: "csam", reason: "Child exploitation content" },
  { pattern: /\bcsam\b/i, tier: "critical", label: "csam", reason: "Child exploitation content" },

  // Terrorism / mass violence
  { pattern: /\bbomb\s*(?:making|recipe|manual|instruction)/i, tier: "critical", label: "terrorism", reason: "Terrorism / violence instructions" },
  { pattern: /\bhow\s*to\s*(?:make|build)\s*(?:a\s*)?(?:bomb|explosive|ied)/i, tier: "critical", label: "terrorism", reason: "Terrorism / violence instructions" },
  { pattern: /\bmass\s*(?:shoot|murder|kill)/i, tier: "critical", label: "terrorism", reason: "Mass violence" },
  { pattern: /\bschool\s*shoot/i, tier: "critical", label: "terrorism", reason: "Mass violence threats" },

  // Human trafficking
  { pattern: /\bhuman\s*traffick/i, tier: "critical", label: "human_trafficking", reason: "Human trafficking" },
  { pattern: /\bsex\s*(?:slave|traffick)/i, tier: "critical", label: "human_trafficking", reason: "Human trafficking" },
  { pattern: /\bforced\s*(?:prostitution|sex\s*work|labor|labour)/i, tier: "critical", label: "human_trafficking", reason: "Forced labor / trafficking" },

  // ─── HIGH: Strong block/review signal ───
  // Violent threats
  { pattern: /\b(?:i(?:'ll|m\s*going\s*to|m\s*gonna)|we\s*(?:will|shall))\s*(?:kill|murder|shoot|stab|bomb)\b/i, tier: "high", label: "threat", reason: "Direct violent threat" },
  { pattern: /\bkill\s*yourself\b/i, tier: "high", label: "threat", reason: "Incitement to self-harm" },
  { pattern: /\bgo\s*die\b/i, tier: "high", label: "threat", reason: "Incitement to self-harm" },
  { pattern: /\brape\s*(?:you|her|him|them)\b/i, tier: "high", label: "threat", reason: "Sexual violence threat" },
  { pattern: /\bdeath\s*threat/i, tier: "high", label: "threat", reason: "Death threat" },
  { pattern: /\bi\s*(?:will|want\s*to)\s*(?:find|track|hunt)\s*(?:you|them|her|him)\b/i, tier: "high", label: "threat", reason: "Stalking threat" },

  // Hate speech / slurs (these patterns are intentionally broad to catch slurs)
  { pattern: /\bn+[i1!]+g+[e3]+r/i, tier: "high", label: "hate", reason: "Racial slur" },
  { pattern: /\bk+[i1!]+k+e+\b/i, tier: "high", label: "hate", reason: "Antisemitic slur" },
  { pattern: /\bf+[a4@]+g+[o0]+t/i, tier: "high", label: "hate", reason: "Homophobic slur" },
  { pattern: /\btr[a4@]nn(?:y|ie)/i, tier: "high", label: "hate", reason: "Transphobic slur" },
  { pattern: /\bwet\s*back\b/i, tier: "high", label: "hate", reason: "Racial slur" },
  { pattern: /\bsp[i1!]c\b/i, tier: "high", label: "hate", reason: "Racial slur" },
  { pattern: /\bcoon\b/i, tier: "high", label: "hate", reason: "Racial slur" },
  { pattern: /\bgook\b/i, tier: "high", label: "hate", reason: "Racial slur" },
  { pattern: /\bgas\s*the\s*(?:jews|kikes)/i, tier: "high", label: "hate", reason: "Genocide incitement" },
  { pattern: /\b(?:white|black|race)\s*(?:supremac|power|genocide)/i, tier: "high", label: "hate", reason: "Supremacist ideology" },
  { pattern: /\bethnic\s*cleansing\b/i, tier: "high", label: "hate", reason: "Genocide advocacy" },

  // Drug trafficking
  { pattern: /\b(?:buy|sell|order)\b.{0,15}\b(?:cocaine|heroin|fentanyl|meth(?:amphetamine)?)\b/i, tier: "high", label: "drugs", reason: "Drug trafficking language" },
  { pattern: /\b(?:cocaine|heroin|fentanyl)\b.{0,15}\b(?:for\s*sale|delivery|vendor|plug)\b/i, tier: "high", label: "drugs", reason: "Drug trafficking language" },

  // Weapons trafficking
  { pattern: /\bghost\s*gun/i, tier: "high", label: "weapons", reason: "Illegal weapons" },
  { pattern: /\b(?:buy|sell)\b.{0,15}\b(?:gun|firearm|weapon)\b.{0,15}\b(?:no\s*(?:serial|id|background))/i, tier: "high", label: "weapons", reason: "Illegal weapons trafficking" },

  // Financial fraud
  { pattern: /\b(?:buy|sell)\b.{0,15}\b(?:stolen\s*(?:credit|debit)|fullz|cvv|dumps)\b/i, tier: "high", label: "fraud", reason: "Financial fraud / stolen cards" },
  { pattern: /\b(?:fake|forged|counterfeit)\b.{0,12}\b(?:passport|id|license|money)\b/i, tier: "high", label: "fraud", reason: "Counterfeit documents/currency" },
  { pattern: /\b(?:ransomware|ddos)\b.{0,15}\b(?:service|for\s*hire|attack)/i, tier: "high", label: "fraud", reason: "Cybercrime services" },

  // ─── MEDIUM: Review signal ───
  // Harassment
  { pattern: /\byou(?:'re|\s*are)\s*(?:ugly|fat|stupid|worthless|disgusting|pathetic|trash|garbage)/i, tier: "medium", label: "harassment", reason: "Personal insult / harassment" },
  { pattern: /\bkill\s*all\s*\w+/i, tier: "medium", label: "hate", reason: "Group violence language" },
  { pattern: /\b(?:die|rot)\s*in\s*(?:a\s*)?(?:fire|hell|ditch)/i, tier: "medium", label: "harassment", reason: "Hostile / harassing language" },
  { pattern: /\bshut\s*(?:the\s*)?(?:f+uck|hell)\s*up\b/i, tier: "medium", label: "harassment", reason: "Hostile language" },

  // Doxxing / privacy
  { pattern: /\bdox+(?:ed|ing)?\b/i, tier: "medium", label: "doxxing", reason: "Doxxing reference" },
  { pattern: /\bswat+(?:ed|ing)\b/i, tier: "medium", label: "doxxing", reason: "Swatting reference" },
  { pattern: /\bhome\s*address\b.{0,10}\b(?:is|:|of)\b/i, tier: "medium", label: "doxxing", reason: "Potential personal info leak" },

  // Sexual content (adult)
  { pattern: /\bporn(?:ography)?\b/i, tier: "medium", label: "sexual", reason: "Explicit sexual content reference" },
  { pattern: /\bxxx\b/i, tier: "medium", label: "sexual", reason: "Explicit sexual content" },
  { pattern: /\bhentai\b/i, tier: "medium", label: "sexual", reason: "Explicit sexual content" },
  { pattern: /\bnudes?\b/i, tier: "medium", label: "sexual", reason: "Sexual content" },
  { pattern: /\bnsfw\b/i, tier: "medium", label: "sexual", reason: "Not-safe-for-work content flag" },

  // Profanity (context-dependent)
  { pattern: /\bf+u+c+k+(?:ing|er|ed)?\b/i, tier: "medium", label: "profanity", reason: "Strong profanity" },
  { pattern: /\bsh[i1!]t+(?:ty|head|face)?\b/i, tier: "medium", label: "profanity", reason: "Profanity" },
  { pattern: /\bc+u+n+t+\b/i, tier: "medium", label: "profanity", reason: "Strong profanity" },
  { pattern: /\bb[i1!]tch/i, tier: "medium", label: "profanity", reason: "Profanity" },
  { pattern: /\bass\s*hole/i, tier: "medium", label: "profanity", reason: "Profanity" },

  // Scams / social engineering
  { pattern: /\bsend\s*(?:me\s*)?(?:your\s*)?(?:seed\s*phrase|private\s*key|wallet\s*(?:key|password))/i, tier: "medium", label: "scam", reason: "Crypto scam pattern" },
  { pattern: /\bfree\s*(?:crypto|bitcoin|eth|airdrop)\b/i, tier: "medium", label: "scam", reason: "Crypto scam pattern" },
  { pattern: /\bguaranteed\s*(?:returns?|profit|income)/i, tier: "medium", label: "scam", reason: "Financial scam language" },
  { pattern: /\bdouble\s*your\s*(?:money|crypto|bitcoin|eth)/i, tier: "medium", label: "scam", reason: "Doubling scam" },

  // ─── LOW: Spam / nuisance ───
  { pattern: /\bfollow\s*(?:me|my|for)\b.{0,20}\b(?:follow\s*back|f4f|l4l)\b/i, tier: "low", label: "spam", reason: "Spam / follow-for-follow" },
  { pattern: /\b(?:check\s*out|visit)\s*(?:my|this)\b.{0,30}\b(?:link|site|page)\b/i, tier: "low", label: "spam", reason: "Promotional spam" },
  { pattern: /(.)\1{5,}/i, tier: "low", label: "spam", reason: "Repetitive characters (spam indicator)" },
  { pattern: /\bcasino\b/i, tier: "low", label: "spam", reason: "Gambling promotion" },
  { pattern: /\bviagra\b/i, tier: "low", label: "spam", reason: "Pharmaceutical spam" },
];

// Score thresholds for decisions
const BLOCK_SCORE = 0.60;
const REVIEW_SCORE = 0.25;

/**
 * Score text for toxicity using the local word/phrase list.
 * Input should already be normalised via normalizeForModeration().
 */
export function scoreLocalToxicity(normalizedText: string, rawText: string): ToxicityResult {
  const labels = new Set<string>();
  const reasons: string[] = [];
  let score = 0;
  let hasCritical = false;

  // Test against both normalised and raw text
  for (const entry of TOXIC_ENTRIES) {
    if (entry.pattern.test(normalizedText) || entry.pattern.test(rawText)) {
      labels.add(entry.label);
      reasons.push(entry.reason);
      score += TIER_WEIGHT[entry.tier];
      if (entry.tier === "critical") hasCritical = true;
    }
  }

  // Cap score at 1.0
  score = Math.min(1.0, score);

  let decision: SafetyDecision = "allow";
  if (hasCritical || score >= BLOCK_SCORE) {
    decision = "block";
  } else if (score >= REVIEW_SCORE) {
    decision = "review";
  }

  return {
    decision,
    score,
    labels: Array.from(labels),
    reasons: [...new Set(reasons)], // deduplicate
  };
}
