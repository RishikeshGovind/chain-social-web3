import { createHash } from "node:crypto";
import { normalizeAddress } from "@/lib/posts/content";
import { appendComplianceAuditEvent } from "@/lib/server/compliance/store";
import { redactMessageById } from "@/lib/server/messages/store";
import { scanForDarknetContent } from "@/lib/server/moderation/darknet-detect";
import { moderateTextMultiModel } from "@/lib/server/moderation/hf-multi-model";
import { moderateImageWithHuggingFace } from "@/lib/server/moderation/hf-nsfw-image";
import { detectsEvasionAttempt, normalizeForModeration } from "@/lib/server/moderation/text-normalize";
import { scoreLocalToxicity } from "@/lib/server/moderation/toxicity-local";
import { logger } from "@/lib/server/logger";
import { isPrimaryStateStoreHealthy, mergeState, readState } from "@/lib/server/persistence";
import type {
  PersistedMediaFingerprint,
  PersistedModerationReport,
  PersistedModerationState,
  PersistedSafetyActivityRecord,
  PersistedSafetyProfile,
} from "@/lib/server/persistence/types";

export type ModerationEntityType = PersistedModerationReport["entityType"];
export type ModerationReportStatus = PersistedModerationReport["status"];
export type SafetyDecision = "allow" | "review" | "block";

type SafetyActionType = PersistedSafetyActivityRecord["type"];
type SafetyAssessment = {
  decision: SafetyDecision;
  labels: string[];
  reasons: string[];
  links: string[];
  fingerprint: string;
};

const VALID_REASONS = new Set([
  "nudity",
  "sexual_content",
  "harassment",
  "hate",
  "spam",
  "scam",
  "malware",
  "illegal_content",
  "impersonation",
  "other",
]);

const AUTO_HIDE_REASONS = new Set([
  "illegal_content",
  "malware",
  "sexual_content",
  "nudity",
  "terrorism",
  "human_trafficking",
  "drugs",
  "spam",
  "harassment",
  "hate",
  "scam",
]);

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const DEFAULT_BLOCKED_DOMAINS = [
  "grabify.link",
  "iplogger.org",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "2no.co",
  "iplogger.com",
  "iplogger.info",
  "blasze.tk",
  "ps3cfw.com",
  "shorturl.at",
  "urlz.fr",
  "cutt.ly",
  "adf.ly",
  "bc.vc",
  "linkvertise.com",
];
const SCAM_PATTERNS = [
  /\bseed phrase\b/i,
  /\bprivate key\b/i,
  /\bconnect wallet\b/i,
  /\bclaim (now|airdrop|tokens?)\b/i,
  /\bwallet verification\b/i,
  /\bguaranteed returns?\b/i,
  /\bdouble your\b/i,
];
const SEXUAL_PATTERNS = [
  /\bnsfw\b/i,
  /\bexplicit\b/i,
  /\bxxx\b/i,
  /\bsexual\b/i,
  /\bporn(?:ography)?\b/i,
  /\b18\+\b/i,
];
const MINOR_TERMS = [
  /\bchild(?:ren)?\b/i,
  /\bkid(?:s)?\b/i,
  /\bminor(?:s)?\b/i,
  /\bunderage\b/i,
  /\bpreteen\b/i,
  /\bteen(?:ager)?s?\b/i,
  /\byoung boy\b/i,
  /\byoung girl\b/i,
  /\blittle girl\b/i,
  /\blittle boy\b/i,
  /\bschoolgirl\b/i,
  /\bschool boy\b/i,
];
const CSAM_PATTERNS = [
  /\bchild pornography\b/i,
  /\bcp\b/i,
  /\bcsam\b/i,
  /\bchild sexual abuse material\b/i,
  /\bminor porn\b/i,
  /\bunderage porn\b/i,
  /\bsexual(?:ly)? exploit(?:ation|ative)\b/i,
  /\bexplicit\b.{0,20}\bminor\b/i,
  /\bminor\b.{0,20}\bexplicit\b/i,
  /\bteen porn\b/i,
  /\bunderage\b.{0,24}\b(sex|sexual|porn|explicit|nude|naked)\b/i,
  /\b(sex|sexual|porn|explicit|nude|naked)\b.{0,24}\bunderage\b/i,
  /\bchild\b.{0,24}\b(sex|sexual|porn|explicit|nude|naked|abuse)\b/i,
  /\b(sex|sexual|porn|explicit|nude|naked|abuse)\b.{0,24}\bchild\b/i,
  /\bminor\b.{0,24}\b(sex|sexual|porn|explicit|nude|naked|abuse)\b/i,
  /\b(sex|sexual|porn|explicit|nude|naked|abuse)\b.{0,24}\bminor\b/i,
  /\bteen\b.{0,24}\b(sex|sexual|porn|explicit|nude|naked)\b/i,
  /\b(sex|sexual|porn|explicit|nude|naked)\b.{0,24}\bteen\b/i,
];
const MALWARE_PATTERNS = [/\.(exe|apk|dmg|msi|scr|zip)(\s|\?|$)/i, /\bdownload\b.{0,20}\binstaller\b/i];
const HATE_PATTERNS = [/\bkill yourself\b/i, /\bviolent threat\b/i];

// --- Expanded illegal content patterns ---

// Drug trafficking / narcotics
const DRUG_PATTERNS = [
  /\bbuy\b.{0,20}\b(cocaine|heroin|fentanyl|meth|mdma|lsd|ecstasy|ketamine|xanax|oxycodone|percocet)\b/i,
  /\bsell(?:ing)?\b.{0,20}\b(cocaine|heroin|fentanyl|meth|mdma|lsd|ecstasy|ketamine|xanax|oxycodone|percocet)\b/i,
  /\b(cocaine|heroin|fentanyl|meth|mdma|lsd|ecstasy|ketamine)\b.{0,20}\b(for sale|delivery|shipping|order|vendor|plug|dealer)\b/i,
  /\b(vendor|plug|dealer)\b.{0,20}\b(cocaine|heroin|fentanyl|meth|mdma|lsd|ecstasy)\b/i,
  /\bdark\s?(?:net|web)\b.{0,30}\b(drugs?|narcotics?|substances?)\b/i,
  /\b(drugs?|narcotics?|substances?)\b.{0,30}\bdark\s?(?:net|web)\b/i,
];

// Terrorism / extremist violence
const TERRORISM_PATTERNS = [
  /\b(bomb|explosive)\s*(making|recipe|instructions?|manual|guide|how\s*to)\b/i,
  /\b(how\s*to\s*(make|build|construct))\b.{0,30}\b(bomb|explosive|ied|detonator)\b/i,
  /\b(recruit(?:ing|ment)?|join|pledge|allegiance)\b.{0,30}\b(jihad|isis|al.?qaeda|terrorist|caliphate|martyrdom)\b/i,
  /\b(jihad|isis|al.?qaeda|terrorist|caliphate|martyrdom)\b.{0,30}\b(recruit|join|pledge|allegiance)\b/i,
  /\b(attack|target|strike)\b.{0,20}\b(infidels?|civilians?|government|embassy)\b/i,
  /\bmass\s*(shooting|casualt|kill)/i,
];

// Weapons trafficking
const WEAPONS_PATTERNS = [
  /\b(buy|sell|order|purchase|get)\b.{0,20}\b(gun|firearm|weapon|rifle|pistol|handgun|ammunition|ammo|silencer|suppressor)\b.{0,20}\b(no\s*(background|id|serial|papers?|license)|ghost|untraceable)\b/i,
  /\b(ghost\s*gun|3d\s*print(?:ed)?\s*(gun|firearm|weapon)|untraceable\s*(gun|firearm|weapon))\b/i,
  /\b(gun|firearm|weapon)\b.{0,20}\b(for\s+sale|shipping|delivery|dark\s*(?:net|web))\b/i,
  /\b(convert|modify|full\s*auto)\b.{0,20}\b(gun|firearm|weapon|pistol|rifle|glock|ar.?15)\b/i,
];

// Human trafficking
const TRAFFICKING_PATTERNS = [
  /\b(buy|sell|trade|auction)\b.{0,20}\b(girls?|boys?|women|people|humans?|persons?|slaves?)\b/i,
  /\b(girls?|boys?|women)\b.{0,20}\b(for\s+sale|auction|available|fresh|new\s+arrivals?)\b/i,
  /\bhuman\s*trafficking\b/i,
  /\bsex\s*(?:slave|traffic)/i,
  /\bforced\s*(labor|labour|prostitution|sex\s*work)/i,
  /\bsexual\s*servitude\b/i,
];

// Financial fraud / illegal services
const FRAUD_PATTERNS = [
  /\b(buy|sell|order)\b.{0,20}\b(stolen\s*(credit|debit)|fullz|cvv|dumps?|carded|skimm(ed|er))\b/i,
  /\b(stolen\s*(credit|debit)|fullz|cvv|dumps?|carded|skimm(ed|er))\b.{0,20}\b(for\s+sale|available|buy|order)\b/i,
  /\b(fake|counterfeit|forged)\b.{0,15}\b(id|passport|license|diploma|degree|document|money|bills?|currency)\b/i,
  /\b(money\s*launder|launder(?:ing)?\s*money|wash(?:ing)?\s*money)\b/i,
  /\b(ransomware|ddos)\b.{0,20}\b(service|for\s+hire|attack|rent)\b/i,
  /\b(hack(?:ing|er)?)\b.{0,20}\b(for\s+hire|service|account|password)\b/i,
];

// Doxxing / privacy violations
const DOXXING_PATTERNS = [
  /\b(dox(?:x)?(?:ed|ing)?|leak(?:ed|ing)?)\b.{0,20}\b(address|phone|ssn|social\s*security|personal\s*info)\b/i,
  /\b(home\s*address|phone\s*number|social\s*security)\b.{0,15}\b(of|for|is|:)\b/i,
  /\bswat(?:t)?(?:ed|ing)\b/i,
];

let cache: PersistedModerationState | null = null;
let writeChain = Promise.resolve();

function defaultModerationState(): PersistedModerationState {
  return {
    reports: [],
    hiddenPostIds: [],
    hiddenReplyIds: [],
    hiddenProfileAddresses: [],
    bannedAddresses: [],
    blockedMediaUrls: [],
    quarantinedMediaUrls: [],
    approvedRemoteMediaUrls: [],
    safetyProfiles: [],
    mediaFingerprints: [],
  };
}

async function loadStore(): Promise<PersistedModerationState> {
  if (cache) return cache;
  const state = await readState();
  cache = state.moderation
    ? {
        reports: Array.isArray(state.moderation.reports) ? state.moderation.reports : [],
        hiddenPostIds: Array.isArray(state.moderation.hiddenPostIds)
          ? state.moderation.hiddenPostIds
          : [],
        hiddenReplyIds: Array.isArray(state.moderation.hiddenReplyIds)
          ? state.moderation.hiddenReplyIds
          : [],
        hiddenProfileAddresses: Array.isArray(state.moderation.hiddenProfileAddresses)
          ? state.moderation.hiddenProfileAddresses.map((value) => normalizeAddress(String(value)))
          : [],
        bannedAddresses: Array.isArray(state.moderation.bannedAddresses)
          ? state.moderation.bannedAddresses.map((value) => normalizeAddress(String(value)))
          : [],
        blockedMediaUrls: Array.isArray(state.moderation.blockedMediaUrls)
          ? state.moderation.blockedMediaUrls.map((value) => String(value))
          : [],
        quarantinedMediaUrls: Array.isArray(state.moderation.quarantinedMediaUrls)
          ? state.moderation.quarantinedMediaUrls.map((value) => String(value))
          : [],
        approvedRemoteMediaUrls: Array.isArray(state.moderation.approvedRemoteMediaUrls)
          ? state.moderation.approvedRemoteMediaUrls.map((value) => String(value))
          : [],
        safetyProfiles: Array.isArray(state.moderation.safetyProfiles)
          ? (state.moderation.safetyProfiles as PersistedSafetyProfile[])
          : [],
        mediaFingerprints: Array.isArray(state.moderation.mediaFingerprints)
          ? (state.moderation.mediaFingerprints as PersistedMediaFingerprint[])
          : [],
      }
    : defaultModerationState();
  return cache;
}

async function saveStore(store: PersistedModerationState) {
  writeChain = writeChain.then(() => mergeState({ moderation: store }));
  await writeChain;
}

function normalizeReason(value: unknown) {
  if (typeof value !== "string") return null;
  const reason = value.trim().toLowerCase();
  return VALID_REASONS.has(reason) ? reason : null;
}

// Parsed once at module load to avoid re-splitting env vars on every call
const _cachedBlockedTerms = (process.env.CHAINSOCIAL_BLOCKED_TERMS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const _cachedBlockedDomains = [
  ...DEFAULT_BLOCKED_DOMAINS,
  ...(process.env.CHAINSOCIAL_BLOCKED_DOMAINS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
];

function parseBlockedTerms() {
  return _cachedBlockedTerms;
}

function parseBlockedDomains() {
  return _cachedBlockedDomains;
}

function hashText(value: string) {
  return createHash("sha256")
    .update(value.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function extractUrls(text: string) {
  return Array.from(text.matchAll(URL_REGEX)).map((match) => match[0]);
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function defaultSafetyProfile(address: string): PersistedSafetyProfile {
  const now = new Date().toISOString();
  return {
    address: normalizeAddress(address),
    trustScore: 78,
    riskLevel: "low",
    labels: ["new"],
    penalties: 0,
    actionCounts: {
      posts: 0,
      replies: 0,
      messages: 0,
      uploads: 0,
      follows: 0,
      reportsReceived: 0,
      reportsSubmitted: 0,
      autoActions: 0,
      thresholdActions: 0,
    },
    recentActivity: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getOrCreateSafetyProfile(store: PersistedModerationState, address: string) {
  const normalized = normalizeAddress(address);
  let profile = store.safetyProfiles.find((item) => item.address === normalized);
  if (!profile) {
    profile = defaultSafetyProfile(normalized);
    store.safetyProfiles.unshift(profile);
  }
  return profile;
}

function addSafetyActivity(
  profile: PersistedSafetyProfile,
  activity: { type: SafetyActionType; fingerprint?: string }
) {
  profile.recentActivity.unshift({
    type: activity.type,
    timestamp: new Date().toISOString(),
    ...(activity.fingerprint ? { fingerprint: activity.fingerprint } : {}),
  });
  profile.recentActivity = profile.recentActivity.slice(0, 40);
}

function incrementActionCount(profile: PersistedSafetyProfile, type: SafetyActionType) {
  switch (type) {
    case "post":
      profile.actionCounts.posts += 1;
      break;
    case "reply":
      profile.actionCounts.replies += 1;
      break;
    case "message":
      profile.actionCounts.messages += 1;
      break;
    case "upload":
      profile.actionCounts.uploads += 1;
      break;
    case "follow":
      profile.actionCounts.follows += 1;
      break;
    case "report_received":
      profile.actionCounts.reportsReceived += 1;
      break;
    case "report_submitted":
      profile.actionCounts.reportsSubmitted += 1;
      break;
    case "auto_action":
      profile.actionCounts.autoActions += 1;
      break;
    case "threshold_action":
      profile.actionCounts.thresholdActions += 1;
      break;
    default:
      break;
  }
}

function recalculateSafetyProfile(profile: PersistedSafetyProfile) {
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;
  const duplicateFingerprints = new Map<string, number>();
  let recentBurstCount = 0;

  for (const activity of profile.recentActivity) {
    const ts = Date.parse(activity.timestamp);
    if (!Number.isNaN(ts) && ts >= tenMinutesAgo) {
      recentBurstCount += 1;
    }
    if (activity.fingerprint) {
      duplicateFingerprints.set(
        activity.fingerprint,
        (duplicateFingerprints.get(activity.fingerprint) ?? 0) + 1
      );
    }
  }

  const maxDuplicateCount = Math.max(0, ...duplicateFingerprints.values());
  const penalties =
    profile.actionCounts.reportsReceived * 5 +
    profile.actionCounts.autoActions * 18 +
    profile.actionCounts.thresholdActions * 20 +
    Math.max(0, recentBurstCount - 12) * 2 +
    Math.max(0, maxDuplicateCount - 2) * 8 +
    profile.penalties;

  profile.trustScore = clamp(90 - penalties, 0, 100);
  profile.riskLevel =
    profile.trustScore < 35 ? "high" : profile.trustScore < 65 ? "medium" : "low";

  const labels = new Set<string>();
  if (profile.riskLevel === "high") labels.add("high-risk");
  if (profile.actionCounts.autoActions > 0) labels.add("auto-moderated");
  if (profile.actionCounts.thresholdActions > 0) labels.add("rate-limited");
  if (profile.actionCounts.reportsReceived > 0) labels.add("reported");
  if (maxDuplicateCount >= 3) labels.add("duplicate-content");
  if (recentBurstCount >= 12) labels.add("burst-activity");
  if (labels.size === 0) {
    labels.add(profile.actionCounts.posts + profile.actionCounts.replies > 5 ? "established" : "new");
  }
  profile.labels = Array.from(labels).slice(0, 4);
  profile.updatedAt = new Date().toISOString();
}

function testPatterns(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function classifyTextContent(text: string): SafetyAssessment {
  const rawText = text.trim();
  // Run pattern matching on BOTH raw and normalized text to catch evasion
  const normalizedText = normalizeForModeration(rawText);
  const usesEvasion = detectsEvasionAttempt(rawText);
  const labels = new Set<string>();
  const reasons: string[] = [];
  const links = extractUrls(rawText);
  const blockedDomains = new Set(parseBlockedDomains());

  // Flag evasion attempts as suspicious
  if (usesEvasion) {
    labels.add("evasion-attempt");
    reasons.push("Text uses filter evasion techniques (homoglyphs, leet speak, or invisible characters)");
  }

  // Check blocked terms on both raw and normalized text
  const blockedTerm = checkBlockedTerms(rawText) ?? checkBlockedTerms(normalizedText);
  if (blockedTerm) {
    labels.add("blocked-terms");
    reasons.push(`Matched blocked term: ${blockedTerm}`);
  }

  // Helper: match against either raw or normalized text
  const matchesAny = (patterns: RegExp[]) =>
    testPatterns(rawText, patterns) || testPatterns(normalizedText, patterns);

  if (matchesAny(SCAM_PATTERNS)) {
    labels.add("scam");
    reasons.push("Matched known scam phrase");
  }
  if (matchesAny(SEXUAL_PATTERNS)) {
    labels.add("sexual_content");
    reasons.push("Matched explicit sexual phrase");
  }
  if (matchesAny(CSAM_PATTERNS)) {
    labels.add("csam");
    labels.add("illegal_content");
    labels.add("sexual_content");
    reasons.push("Matched child sexual abuse or exploitation language");
  }
  const mentionsMinor = MINOR_TERMS.some((p) => p.test(rawText) || p.test(normalizedText));
  const mentionsSexual = SEXUAL_PATTERNS.some((p) => p.test(rawText) || p.test(normalizedText));
  if (mentionsMinor && mentionsSexual) {
    labels.add("csam");
    labels.add("illegal_content");
    labels.add("sexual_content");
    reasons.push("Combined minor-related and sexual language");
  }
  if (matchesAny(MALWARE_PATTERNS)) {
    labels.add("malware");
    reasons.push("Matched malware or executable pattern");
  }
  if (matchesAny(HATE_PATTERNS)) {
    labels.add("hate");
    reasons.push("Matched hate or threat phrase");
  }

  // --- New illegal content categories ---

  if (matchesAny(DRUG_PATTERNS)) {
    labels.add("drugs");
    labels.add("illegal_content");
    reasons.push("Matched drug trafficking or narcotics sales language");
  }
  if (matchesAny(TERRORISM_PATTERNS)) {
    labels.add("terrorism");
    labels.add("illegal_content");
    reasons.push("Matched terrorism or extremist violence language");
  }
  if (matchesAny(WEAPONS_PATTERNS)) {
    labels.add("weapons_trafficking");
    labels.add("illegal_content");
    reasons.push("Matched illegal weapons trafficking language");
  }
  if (matchesAny(TRAFFICKING_PATTERNS)) {
    labels.add("human_trafficking");
    labels.add("illegal_content");
    reasons.push("Matched human trafficking language");
  }
  if (matchesAny(FRAUD_PATTERNS)) {
    labels.add("fraud");
    labels.add("illegal_content");
    reasons.push("Matched financial fraud or illegal services language");
  }
  if (matchesAny(DOXXING_PATTERNS)) {
    labels.add("doxxing");
    reasons.push("Matched doxxing or privacy violation language");
  }

  if (links.length >= 3) {
    labels.add("spam");
    reasons.push("Contains an unusual number of links");
  }
  if (/[A-Z]{12,}/.test(rawText) || rawText.includes("!!!")) {
    labels.add("spam");
    reasons.push("Looks like promotional or spammy formatting");
  }

  for (const url of links) {
    const hostname = hostnameFromUrl(url);
    if (!hostname) continue;
    if (hostname.includes("xn--") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      labels.add("scam");
      reasons.push("Contains suspicious hostname format");
    }
    if (
      blockedDomains.has(hostname) ||
      Array.from(blockedDomains).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    ) {
      labels.add("blocked-domain");
      reasons.push(`Contains blocked domain: ${hostname}`);
    }
  }

  // Evasion + any risk signal → escalate to block
  if (usesEvasion && labels.size > 1) {
    labels.add("evasion-escalated");
    reasons.push("Evasion techniques combined with harmful content — auto-blocked");
  }

  const decision: SafetyDecision =
    labels.has("malware") ||
    labels.has("csam") ||
    labels.has("sexual_content") ||
    labels.has("blocked-domain") ||
    labels.has("blocked-terms") ||
    labels.has("illegal_content") ||
    labels.has("human_trafficking") ||
    labels.has("terrorism") ||
    labels.has("evasion-escalated")
      ? "block"
      : labels.has("scam") || labels.has("hate") || labels.has("spam") ||
        labels.has("doxxing") || labels.has("fraud") ||
        labels.has("weapons_trafficking") || labels.has("evasion-attempt")
        ? "review"
        : "allow";

  return {
    decision,
    labels: Array.from(labels),
    reasons,
    links,
    fingerprint: hashText(rawText),
  };
}

function mergeTextAssessments(
  base: SafetyAssessment,
  external: { decision: SafetyDecision; labels: string[]; reasons: string[] } | null
) {
  if (!external) return base;

  const decisionOrder: Record<SafetyDecision, number> = {
    allow: 0,
    review: 1,
    block: 2,
  };

  return {
    ...base,
    decision:
      decisionOrder[external.decision] > decisionOrder[base.decision]
        ? external.decision
        : base.decision,
    labels: Array.from(new Set([...base.labels, ...external.labels])),
    reasons: Array.from(new Set([...base.reasons, ...external.reasons])),
  };
}

export function checkBlockedTerms(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  for (const term of parseBlockedTerms()) {
    if (term && normalized.includes(term)) {
      return term;
    }
  }
  return null;
}

export async function getPublicTrustProfile(address: string) {
  const store = await loadStore();
  const profile = getOrCreateSafetyProfile(store, address);
  recalculateSafetyProfile(profile);
  await saveStore(store);
  return {
    address: profile.address,
    trustScore: profile.trustScore,
    riskLevel: profile.riskLevel,
    labels: profile.labels,
  };
}

export async function recordSafetyEvent(input: {
  address: string;
  type: SafetyActionType;
  fingerprint?: string;
  penalty?: number;
}) {
  const store = await loadStore();
  const profile = getOrCreateSafetyProfile(store, input.address);
  addSafetyActivity(profile, { type: input.type, fingerprint: input.fingerprint });
  incrementActionCount(profile, input.type);
  profile.penalties += input.penalty ?? 0;
  recalculateSafetyProfile(profile);

  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;
  const recentSameType = profile.recentActivity.filter((activity) => {
    const ts = Date.parse(activity.timestamp);
    return activity.type === input.type && !Number.isNaN(ts) && ts >= tenMinutesAgo;
  }).length;
  const duplicateCount = input.fingerprint
    ? profile.recentActivity.filter((activity) => activity.fingerprint === input.fingerprint).length
    : 0;

  let thresholdTriggered = false;
  let thresholdReason: string | null = null;
  const limitByType: Partial<Record<SafetyActionType, number>> = {
    post: 8,
    reply: 12,
    message: 18,
    upload: 6,
    follow: 25,
  };

  if (limitByType[input.type] && recentSameType > (limitByType[input.type] ?? Number.MAX_SAFE_INTEGER)) {
    thresholdTriggered = true;
    thresholdReason = `${input.type} burst exceeded`;
  } else if (duplicateCount >= 3) {
    thresholdTriggered = true;
    thresholdReason = "duplicate content detected";
  }

  if (thresholdTriggered) {
    if (!store.bannedAddresses.includes(profile.address)) {
      store.bannedAddresses.unshift(profile.address);
    }
    addSafetyActivity(profile, { type: "threshold_action", fingerprint: input.fingerprint });
    incrementActionCount(profile, "threshold_action");
    profile.penalties += 18;
    recalculateSafetyProfile(profile);
    await appendComplianceAuditEvent({
      type: "moderation.threshold_action.applied",
      actor: profile.address,
      metadata: {
        reason: thresholdReason,
        sourceType: input.type,
      },
    });
  }

  await saveStore(store);
  return {
    trustScore: profile.trustScore,
    riskLevel: profile.riskLevel,
    thresholdTriggered,
    thresholdReason,
  };
}

export async function evaluateTextSafety(input: {
  address: string;
  text: string;
  type: Extract<SafetyActionType, "post" | "reply" | "message" | "profile_update">;
}) {
  const localAssessment = classifyTextContent(input.text);

  // Layer 2: Local toxicity word-list scorer (free, in-process)
  const normalizedText = normalizeForModeration(input.text);
  const toxicity = scoreLocalToxicity(normalizedText, input.text.trim());
  const afterToxicity = mergeTextAssessments(localAssessment, {
    decision: toxicity.decision,
    labels: toxicity.labels,
    reasons: toxicity.reasons,
  });

  // Layer 3: Darknet / covert content scanner (free, in-process)
  const darknetScan = scanForDarknetContent(input.text);
  const afterDarknet = mergeTextAssessments(afterToxicity, {
    decision: darknetScan.decision,
    labels: darknetScan.labels,
    reasons: darknetScan.reasons,
  });

  // Layer 4: HF multi-model (free, optional — needs HUGGINGFACE_API_TOKEN)
  // Only call HF when local layers flag content as "review" or "block" —
  // skip the ~2-3s HF round-trip for clearly safe content.
  let assessment = afterDarknet;
  if (afterDarknet.decision !== "allow") {
    const hfAssessment = await moderateTextMultiModel(input.text);
    assessment = mergeTextAssessments(afterDarknet, hfAssessment);
  }
  const store = await loadStore();
  const profile = getOrCreateSafetyProfile(store, input.address);
  recalculateSafetyProfile(profile);
  const isLowTrust = profile.trustScore < 70 || profile.labels.includes("new");
  const hasRiskSignal =
    assessment.labels.includes("sexual_content") ||
    assessment.labels.includes("illegal_content") ||
    assessment.labels.includes("scam") ||
    assessment.labels.includes("hate") ||
    assessment.labels.includes("darknet") ||
    assessment.labels.includes("onion-link") ||
    assessment.labels.includes("encrypted-content") ||
    assessment.links.length > 0;
  if (isLowTrust && hasRiskSignal && assessment.decision !== "block") {
    assessment.decision = "block";
    assessment.labels.push("low-trust-escalation");
    assessment.reasons.push("Low-trust account attempted risky content.");
  }
  const behavior = await recordSafetyEvent({
    address: input.address,
    type: input.type,
    fingerprint: assessment.fingerprint,
    penalty:
      assessment.labels.includes("csam")
        ? 40
        : assessment.decision === "block"
          ? 8
          : assessment.decision === "review"
            ? 4
            : 0,
  });
  if (assessment.labels.includes("csam")) {
    const normalizedAddress = normalizeAddress(input.address);
    if (!store.bannedAddresses.includes(normalizedAddress)) {
      store.bannedAddresses.unshift(normalizedAddress);
    }
    const bannedProfile = getOrCreateSafetyProfile(store, normalizedAddress);
    incrementActionCount(bannedProfile, "auto_action");
    addSafetyActivity(bannedProfile, { type: "auto_action", fingerprint: assessment.fingerprint });
    bannedProfile.penalties += 50;
    recalculateSafetyProfile(bannedProfile);
    await saveStore(store);
    await appendComplianceAuditEvent({
      type: "moderation.csam_text_blocked",
      actor: normalizedAddress,
      metadata: {
        sourceType: input.type,
        fingerprint: assessment.fingerprint,
        reasons: assessment.reasons,
      },
    });
  }
  return {
    ...assessment,
    ...behavior,
  };
}

export async function evaluateFollowSafety(address: string, targetAddress: string) {
  return recordSafetyEvent({
    address,
    type: "follow",
    fingerprint: hashText(`${normalizeAddress(address)}:${normalizeAddress(targetAddress)}`),
  });
}

export async function inspectMediaBuffer(input: {
  actorAddress: string;
  buffer: Buffer;
  mimeType: string;
}) {
  const store = await loadStore();
  const sha256 = hashBuffer(input.buffer);
  const existing = store.mediaFingerprints.find((item) => item.sha256 === sha256);
  let decision: SafetyDecision = "allow";
  const labels: string[] = [];
  let reason: string | null = null;

  if (existing?.status === "blocked") {
    decision = "block";
    labels.push("hash-match");
    reason = "Matches a previously blocked media file.";
  } else if (existing?.status === "quarantined") {
    decision = "review";
    labels.push("hash-match");
    reason = "Matches media already pending review.";
  }

  // HF NSFW image detection (free, uses same HUGGINGFACE_API_TOKEN)
  if (decision !== "block") {
    const nsfwResult = await moderateImageWithHuggingFace({
      buffer: input.buffer,
      mimeType: input.mimeType,
    });
    if (nsfwResult) {
      if (nsfwResult.decision === "block" || (nsfwResult.decision === "review" && decision === "allow")) {
        decision = nsfwResult.decision;
      }
      labels.push(...nsfwResult.labels);
      if (nsfwResult.reason) reason = nsfwResult.reason;
    }
  }

  const moderationUrl = process.env.CHAINSOCIAL_IMAGE_MODERATION_URL?.trim();
  if (moderationUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(moderationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mimeType: input.mimeType,
          sha256,
          data: input.buffer.toString("base64"),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        decision?: SafetyDecision;
        labels?: string[];
        reason?: string;
      };
      if (response.ok && payload.decision) {
        decision = payload.decision;
        labels.push(...(payload.labels ?? []));
        if (payload.reason) reason = payload.reason;
      }
    } catch {
      // Best-effort only; do not block uploads on hook failure.
    } finally {
      clearTimeout(timer);
    }
  }

  const behavior = await recordSafetyEvent({
    address: input.actorAddress,
    type: "upload",
    fingerprint: sha256,
    penalty: decision === "block" ? 10 : decision === "review" ? 3 : 0,
  });

  return {
    sha256,
    decision: behavior.thresholdTriggered ? "block" : decision,
    labels: Array.from(new Set(labels)),
    reason: behavior.thresholdTriggered
      ? behavior.thresholdReason ?? "Upload threshold exceeded."
      : reason,
  };
}

export async function registerMediaFingerprint(input: {
  actorAddress: string;
  sha256: string;
  url?: string;
  mimeType?: string;
  status: PersistedMediaFingerprint["status"];
  labels?: string[];
}) {
  const store = await loadStore();
  const existing = store.mediaFingerprints.find((item) => item.sha256 === input.sha256);
  if (existing) {
    existing.status = input.status;
    existing.updatedAt = new Date().toISOString();
    if (input.url) existing.url = input.url;
    if (input.mimeType) existing.mimeType = input.mimeType;
    existing.labels = Array.from(new Set([...(existing.labels ?? []), ...(input.labels ?? [])]));
  } else {
    store.mediaFingerprints.unshift({
      actorAddress: normalizeAddress(input.actorAddress),
      sha256: input.sha256,
      ...(input.url ? { url: input.url } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      status: input.status,
      labels: input.labels ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  store.mediaFingerprints = store.mediaFingerprints.slice(0, 500);
  await saveStore(store);
}

export async function isAddressBanned(address: string) {
  const store = await loadStore();
  return store.bannedAddresses.includes(normalizeAddress(address));
}

export async function isProfileHidden(address: string) {
  const store = await loadStore();
  return store.hiddenProfileAddresses.includes(normalizeAddress(address));
}

export async function listModerationState() {
  const store = await loadStore();
  return store;
}

/**
 * Remove auto-generated media quarantine reports and quarantined URLs
 * that were created by the (now-removed) aggressive remote-media
 * quarantine on the read path. Only clears "media" reports with status
 * "open" and reason "other" that contain the auto-generated detail text.
 */
export async function clearAutoQuarantineReports() {
  const store = await loadStore();
  const before = {
    reports: store.reports.length,
    quarantined: store.quarantinedMediaUrls.length,
  };

  // Remove auto-generated media-quarantine reports
  store.reports = store.reports.filter(
    (r) =>
      !(
        r.entityType === "media" &&
        r.status === "open" &&
        r.reason === "other" &&
        typeof r.details === "string" &&
        (r.details.includes("Remote media hidden automatically") ||
          r.details.includes("Media upload requires manual review"))
      )
  );

  // Clear quarantined URLs (keep manually blocked ones)
  store.quarantinedMediaUrls = [];

  await saveStore(store);
  return {
    removedReports: before.reports - store.reports.length,
    clearedQuarantined: before.quarantined,
  };
}

function isRelativeMediaUrl(url: string) {
  return url.startsWith("/");
}

/**
 * Known Lens ecosystem / IPFS media hosts. Media from these origins is
 * served by the Lens protocol infrastructure or trusted gateways and
 * should not be auto-quarantined on the read path.
 */
const TRUSTED_MEDIA_HOSTS = new Set([
  "ipfs.io",
  "gateway.pinata.cloud",
  "cloudflare-ipfs.com",
  "w3s.link",
  "dweb.link",
  "nftstorage.link",
  "lens.infura-ipfs.io",
  "arweave.net",
  "ik.imagekit.io",
  "storage.googleapis.com",
  "gw.ipfs-lens.dev",
  "api.grove.storage",
]);

function isTrustedMediaHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return [...TRUSTED_MEDIA_HOSTS].some(
      (h) => hostname === h || hostname.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

function isCleanMediaUrl(store: PersistedModerationState, url: string) {
  if (isRelativeMediaUrl(url)) return true;
  if (isTrustedMediaHost(url)) return true;
  if (store.approvedRemoteMediaUrls.includes(url)) return true;
  return store.mediaFingerprints.some(
    (item) => item.url === url && item.status === "clean"
  );
}

export async function createModerationReport(input: {
  reporterAddress: string;
  entityType: ModerationEntityType;
  entityId: string;
  targetAddress?: string;
  reason: unknown;
  details?: unknown;
}) {
  const reason = normalizeReason(input.reason);
  if (!reason) {
    return { ok: false as const, error: "Invalid report reason" };
  }
  const entityId = String(input.entityId ?? "").trim();
  if (!entityId) {
    return { ok: false as const, error: "Missing report target" };
  }

  const details =
    typeof input.details === "string" ? input.details.trim().slice(0, 500) : undefined;
  const store = await loadStore();
  const now = new Date().toISOString();
  const report: PersistedModerationReport = {
    id: crypto.randomUUID(),
    reporterAddress: normalizeAddress(input.reporterAddress),
    entityType: input.entityType,
    entityId,
    ...(input.targetAddress ? { targetAddress: normalizeAddress(input.targetAddress) } : {}),
    reason,
    ...(details ? { details } : {}),
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  store.reports.unshift(report);

  const reporterProfile = getOrCreateSafetyProfile(store, report.reporterAddress);
  incrementActionCount(reporterProfile, "report_submitted");
  addSafetyActivity(reporterProfile, { type: "report_submitted" });
  recalculateSafetyProfile(reporterProfile);

  if (report.targetAddress) {
    const targetProfile = getOrCreateSafetyProfile(store, report.targetAddress);
    incrementActionCount(targetProfile, "report_received");
    addSafetyActivity(targetProfile, { type: "report_received" });
    targetProfile.penalties += 4;
    recalculateSafetyProfile(targetProfile);
  }

  const autoAction = AUTO_HIDE_REASONS.has(report.reason)
    ? await (async () => {
        switch (report.entityType) {
          case "post":
            if (!store.hiddenPostIds.includes(report.entityId)) {
              store.hiddenPostIds.unshift(report.entityId);
            }
            return "hide_post";
          case "reply":
            if (!store.hiddenReplyIds.includes(report.entityId)) {
              store.hiddenReplyIds.unshift(report.entityId);
            }
            return "hide_reply";
          case "profile":
            if (report.targetAddress) {
              const normalized = normalizeAddress(report.targetAddress);
              if (!store.hiddenProfileAddresses.includes(normalized)) {
                store.hiddenProfileAddresses.unshift(normalized);
              }
            }
            return "hide_profile";
          case "media":
            if (!store.blockedMediaUrls.includes(report.entityId)) {
              store.blockedMediaUrls.unshift(report.entityId);
            }
            store.quarantinedMediaUrls = store.quarantinedMediaUrls.filter(
              (value) => value !== report.entityId
            );
            {
              const mediaFingerprint = store.mediaFingerprints.find((item) => item.url === report.entityId);
              if (mediaFingerprint) {
                mediaFingerprint.status = "blocked";
                mediaFingerprint.updatedAt = new Date().toISOString();
              }
            }
            return "block_media";
          case "message":
            // Redact the offending message content
            if (report.entityId) {
              await redactMessageById(report.entityId);
            }
            if (report.targetAddress) {
              const normalized = normalizeAddress(report.targetAddress);
              if (!store.bannedAddresses.includes(normalized)) {
                store.bannedAddresses.unshift(normalized);
              }
            }
            return "ban_address";
          default:
            return null;
        }
      })()
    : null;

  if (autoAction) {
    report.status = "actioned";
    report.action = autoAction;
    report.resolutionNotes =
      "Automatically restricted pending moderator review due to severe report reason.";
    if (report.targetAddress) {
      const targetProfile = getOrCreateSafetyProfile(store, report.targetAddress);
      incrementActionCount(targetProfile, "auto_action");
      addSafetyActivity(targetProfile, { type: "auto_action" });
      targetProfile.penalties += 12;
      recalculateSafetyProfile(targetProfile);
    }
  }

  await saveStore(store);
  await appendComplianceAuditEvent({
    type: "moderation.report.created",
    actor: report.reporterAddress,
    metadata: {
      reportId: report.id,
      entityType: report.entityType,
      entityId: report.entityId,
      targetAddress: report.targetAddress ?? null,
      reason: report.reason,
    },
  });
  if (autoAction) {
    await appendComplianceAuditEvent({
      type: "moderation.auto_action.applied",
      metadata: {
        reportId: report.id,
        action: autoAction,
        entityType: report.entityType,
        entityId: report.entityId,
        targetAddress: report.targetAddress ?? null,
        reason: report.reason,
      },
    });
  }
  return { ok: true as const, report };
}

export async function applyModerationAction(input: {
  reportId?: string;
  action?:
    | "hide_post"
    | "hide_reply"
    | "hide_profile"
    | "ban_address"
    | "unhide_post"
    | "unhide_reply"
    | "unhide_profile"
    | "unban_address"
    | "block_media"
    | "approve_media"
    | "unblock_media"
    | "redact_message"
    | "reject_report";
  entityId?: string;
  address?: string;
  notes?: string;
}) {
  const store = await loadStore();
  const action = input.action;
  if (!action) {
    return { ok: false as const, error: "Missing moderation action" };
  }

  const report = input.reportId
    ? store.reports.find((item) => item.id === input.reportId)
    : undefined;

  const entityId = String(input.entityId ?? report?.entityId ?? "").trim();
  const address = input.address
    ? normalizeAddress(input.address)
    : report?.targetAddress
      ? normalizeAddress(report.targetAddress)
      : "";

  const addUnique = (items: string[], value: string) => {
    if (!value) return;
    if (!items.includes(value)) items.unshift(value);
  };
  const removeValue = (items: string[], value: string) => items.filter((item) => item !== value);

  switch (action) {
    case "hide_post":
      if (!entityId) return { ok: false as const, error: "Missing post id" };
      addUnique(store.hiddenPostIds, entityId);
      break;
    case "hide_reply":
      if (!entityId) return { ok: false as const, error: "Missing reply id" };
      addUnique(store.hiddenReplyIds, entityId);
      break;
    case "hide_profile":
      if (!address) return { ok: false as const, error: "Missing profile address" };
      addUnique(store.hiddenProfileAddresses, address);
      break;
    case "ban_address":
      if (!address) return { ok: false as const, error: "Missing wallet address" };
      addUnique(store.bannedAddresses, address);
      break;
    case "unhide_post":
      store.hiddenPostIds = removeValue(store.hiddenPostIds, entityId);
      break;
    case "unhide_reply":
      store.hiddenReplyIds = removeValue(store.hiddenReplyIds, entityId);
      break;
    case "unhide_profile":
      store.hiddenProfileAddresses = removeValue(store.hiddenProfileAddresses, address);
      break;
    case "unban_address":
      store.bannedAddresses = removeValue(store.bannedAddresses, address);
      break;
    case "reject_report":
      break;
    case "redact_message":
      if (!entityId) return { ok: false as const, error: "Missing message id" };
      await redactMessageById(entityId);
      break;
    case "block_media":
      if (!entityId) return { ok: false as const, error: "Missing media url" };
      store.quarantinedMediaUrls = removeValue(store.quarantinedMediaUrls, entityId);
      store.approvedRemoteMediaUrls = removeValue(store.approvedRemoteMediaUrls, entityId);
      addUnique(store.blockedMediaUrls, entityId);
      {
        const mediaFingerprint = store.mediaFingerprints.find((item) => item.url === entityId);
        if (mediaFingerprint) {
          mediaFingerprint.status = "blocked";
          mediaFingerprint.updatedAt = new Date().toISOString();
        }
      }
      break;
    case "approve_media":
      if (!entityId) return { ok: false as const, error: "Missing media url" };
      store.quarantinedMediaUrls = removeValue(store.quarantinedMediaUrls, entityId);
      addUnique(store.approvedRemoteMediaUrls, entityId);
      {
        const mediaFingerprint = store.mediaFingerprints.find((item) => item.url === entityId);
        if (mediaFingerprint) {
          mediaFingerprint.status = "clean";
          mediaFingerprint.updatedAt = new Date().toISOString();
        }
      }
      break;
    case "unblock_media":
      if (!entityId) return { ok: false as const, error: "Missing media url" };
      store.blockedMediaUrls = removeValue(store.blockedMediaUrls, entityId);
      store.quarantinedMediaUrls = removeValue(store.quarantinedMediaUrls, entityId);
      addUnique(store.approvedRemoteMediaUrls, entityId);
      {
        const mediaFingerprint = store.mediaFingerprints.find((item) => item.url === entityId);
        if (mediaFingerprint) {
          mediaFingerprint.status = "clean";
          mediaFingerprint.updatedAt = new Date().toISOString();
        }
      }
      break;
    default:
      return { ok: false as const, error: "Unsupported moderation action" };
  }

  if (report) {
    report.status = action === "reject_report" ? "rejected" : "actioned";
    report.action = action;
    report.updatedAt = new Date().toISOString();
    if (input.notes?.trim()) {
      report.resolutionNotes = input.notes.trim().slice(0, 500);
    }
  }

  await saveStore(store);
  await appendComplianceAuditEvent({
    type: "moderation.action.applied",
    metadata: {
      reportId: report?.id ?? null,
      action,
      entityId: entityId || null,
      address: address || null,
      notes: input.notes?.trim() ? input.notes.trim().slice(0, 500) : null,
    },
  });
  return {
    ok: true as const,
    state: store,
    report: report ?? null,
  };
}

export async function filterVisiblePosts<T extends { id: string; author: { address: string } }>(
  posts: T[]
) {
  // If Postgres is down and we have no cached moderation state, skip filtering
  // rather than blocking the feed for seconds waiting on a dead database.
  // moderateIncomingPosts still catches illegal content without any store reads.
  if (!cache && !isPrimaryStateStoreHealthy()) {
    return posts;
  }

  // If cache is cold, time-box the store load so a slow DB never blocks the feed.
  if (!cache) {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("filterVisiblePosts store load timeout")), 200)
      );
      await Promise.race([loadStore(), timeout]);
    } catch {
      logger.warn("moderation.filter_skip_slow_store", { reason: "store load exceeded 200ms" });
      return posts;
    }
  }

  const store = await loadStore();
  const hiddenPosts = new Set(store.hiddenPostIds);
  const hiddenProfiles = new Set(store.hiddenProfileAddresses);
  const hiddenMedia = new Set([...store.blockedMediaUrls, ...store.quarantinedMediaUrls]);
  const visiblePosts = posts.filter(
    (post) => !hiddenPosts.has(post.id) && !hiddenProfiles.has(normalizeAddress(post.author.address))
  );

  const filteredPosts = visiblePosts.map((post) => {
    const metadata = (post as { metadata?: { media?: string[] } }).metadata;
    if (!metadata?.media?.length) return post;

    const filteredMedia = metadata.media.filter((url) => {
      // Always allow media from trusted Lens ecosystem/IPFS hosts, even
      // if a previous request mistakenly quarantined them.
      if (isTrustedMediaHost(url)) return true;
      if (hiddenMedia.has(url)) return false;
      if (isCleanMediaUrl(store, url)) return true;
      // Remote Lens feed media from unknown hosts is allowed by default.
      // Only locally-uploaded media goes through quarantine (handled in
      // the upload endpoint). Auto-quarantining every remote URL floods
      // the admin queue with false positives.
      return true;
    });

    return {
      ...post,
      metadata: {
        ...metadata,
        media: filteredMedia,
      },
    };
  });

  return filteredPosts;
}

// ── Read-path content moderation for incoming Lens posts ────────────
// Runs local-only layers (free, instant) on every post, and only calls
// HF models for posts flagged as suspicious by local layers. Results
// are cached by post ID so the same post is never rescanned.

type PostWithContent = {
  id: string;
  author: { address: string };
  metadata?: { content?: string; media?: string[] };
};

type ReadPathCacheEntry = {
  fingerprint: string;
  decision: SafetyDecision;
};

const readPathCache = new Map<string, ReadPathCacheEntry>();
const READ_PATH_CACHE_MAX = 2000;
const fingerprintDecisionCache = new Map<string, SafetyDecision>();
const FINGERPRINT_DECISION_CACHE_MAX = 4000;
const readPathInFlight = new Map<string, Promise<SafetyDecision>>();
const READ_PATH_HF_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_READ_PATH_HUGGINGFACE_TIMEOUT_MS ?? "1200",
  10,
);

function readPathCacheSet(cacheKey: string, fingerprint: string, decision: SafetyDecision) {
  if (readPathCache.size >= READ_PATH_CACHE_MAX) {
    // Evict oldest entry
    const first = readPathCache.keys().next().value;
    if (first !== undefined) readPathCache.delete(first);
  }
  readPathCache.set(cacheKey, { fingerprint, decision });
}

function fingerprintDecisionCacheSet(fingerprint: string, decision: SafetyDecision) {
  if (fingerprintDecisionCache.size >= FINGERPRINT_DECISION_CACHE_MAX) {
    const first = fingerprintDecisionCache.keys().next().value;
    if (first !== undefined) fingerprintDecisionCache.delete(first);
  }
  fingerprintDecisionCache.set(fingerprint, decision);
}

function getReadPathHfTimeoutMs() {
  return Number.isFinite(READ_PATH_HF_TIMEOUT_MS) && READ_PATH_HF_TIMEOUT_MS > 0
    ? READ_PATH_HF_TIMEOUT_MS
    : 1200;
}

function shouldEscalateReadPathToHf(assessment: SafetyAssessment) {
  if (assessment.decision !== "review") return false;

  const labels = new Set(assessment.labels);
  if (
    labels.has("hate") ||
    labels.has("threat") ||
    labels.has("doxxing") ||
    labels.has("fraud") ||
    labels.has("weapons_trafficking") ||
    labels.has("weapons") ||
    labels.has("harassment") ||
    labels.has("sexual") ||
    labels.has("profanity")
  ) {
    return true;
  }

  if (labels.has("scam") && assessment.links.length > 0) {
    return true;
  }

  return false;
}

async function resolveReadPathDecision(
  fingerprint: string,
  assessment: SafetyAssessment,
  text: string,
): Promise<SafetyDecision> {
  const cached = fingerprintDecisionCache.get(fingerprint);
  if (cached) return cached;

  if (assessment.decision === "block") {
    fingerprintDecisionCacheSet(fingerprint, "block");
    return "block";
  }

  if (!shouldEscalateReadPathToHf(assessment)) {
    fingerprintDecisionCacheSet(fingerprint, "allow");
    return "allow";
  }

  const existing = readPathInFlight.get(fingerprint);
  if (existing) return existing;

  const pending = (async () => {
    const hfResult = await moderateTextMultiModel(text, {
      timeoutMs: getReadPathHfTimeoutMs(),
    });
    const merged = mergeTextAssessments(assessment, hfResult);
    const decision = merged.decision === "block" ? "block" : "allow";
    fingerprintDecisionCacheSet(fingerprint, decision);
    return decision;
  })().finally(() => {
    readPathInFlight.delete(fingerprint);
  });

  readPathInFlight.set(fingerprint, pending);
  return pending;
}

async function moderateIncomingTextEntities<T extends PostWithContent>(
  items: T[],
  cacheNamespace: string
): Promise<T[]> {
  if (items.length === 0) return items;

  const results = new Map<string, SafetyDecision>();

  await Promise.all(
    items.map(async (item) => {
      const text = item.metadata?.content?.trim() ?? "";
      const fingerprint = hashText(text);
      const cacheKey = `${cacheNamespace}:${item.id}`;
      const cached = readPathCache.get(cacheKey);
      if (cached && cached.fingerprint === fingerprint) {
        results.set(item.id, cached.decision);
        return;
      }

      const cachedByFingerprint = fingerprintDecisionCache.get(fingerprint);
      if (cachedByFingerprint) {
        readPathCacheSet(cacheKey, fingerprint, cachedByFingerprint);
        results.set(item.id, cachedByFingerprint);
        return;
      }

      if (!text) {
        readPathCacheSet(cacheKey, fingerprint, "allow");
        fingerprintDecisionCacheSet(fingerprint, "allow");
        results.set(item.id, "allow");
        return;
      }

      const patternResult = classifyTextContent(text);
      const normalizedText = normalizeForModeration(text);
      const toxicity = scoreLocalToxicity(normalizedText, text);
      const afterToxicity = mergeTextAssessments(patternResult, {
        decision: toxicity.decision,
        labels: toxicity.labels,
        reasons: toxicity.reasons,
      });
      const darknet = scanForDarknetContent(text);
      const localResult = mergeTextAssessments(afterToxicity, {
        decision: darknet.decision,
        labels: darknet.labels,
        reasons: darknet.reasons,
      });
      const decision = await resolveReadPathDecision(fingerprint, localResult, text);
      readPathCacheSet(cacheKey, fingerprint, decision);
      results.set(item.id, decision);
    })
  );

  return items.filter((item) => (results.get(item.id) ?? "allow") !== "block");
}

/**
 * Scan incoming feed posts through moderation layers and filter out
 * blocked content. Designed for the read path — uses only fast local
 * checks by default and escalates to HF models only when local checks
 * flag something suspicious.
 */
export async function moderateIncomingPosts<T extends PostWithContent>(
  posts: T[],
): Promise<T[]> {
  return moderateIncomingTextEntities(posts, "post");
}

export async function moderateIncomingReplies<T extends PostWithContent>(
  replies: T[],
): Promise<T[]> {
  return moderateIncomingTextEntities(replies, "reply");
}

export async function filterVisibleReplies<T extends { id: string; author: { address: string } }>(
  replies: T[]
) {
  const store = await loadStore();
  const hiddenReplies = new Set(store.hiddenReplyIds);
  const hiddenProfiles = new Set(store.hiddenProfileAddresses);
  return replies.filter(
    (reply) =>
      !hiddenReplies.has(reply.id) &&
      !hiddenProfiles.has(normalizeAddress(reply.author.address))
  );
}

export async function quarantineMediaUpload(input: {
  url: string;
  actorAddress: string;
  mimeType?: string;
  sha256?: string;
  labels?: string[];
}) {
  const store = await loadStore();
  if (!store.quarantinedMediaUrls.includes(input.url)) {
    store.quarantinedMediaUrls.unshift(input.url);
  }
  await saveStore(store);
  if (input.sha256) {
    await registerMediaFingerprint({
      actorAddress: input.actorAddress,
      sha256: input.sha256,
      url: input.url,
      mimeType: input.mimeType,
      status: "quarantined",
      labels: input.labels,
    });
  }
  await appendComplianceAuditEvent({
    type: "moderation.media.quarantined",
    actor: normalizeAddress(input.actorAddress),
    metadata: {
      url: input.url,
      mimeType: input.mimeType ?? null,
      sha256: input.sha256 ?? null,
    },
  });
  return createModerationReport({
    reporterAddress: normalizeAddress(input.actorAddress),
    entityType: "media",
    entityId: input.url,
    targetAddress: input.actorAddress,
    reason: "other",
    details: `Media upload requires manual review${input.mimeType ? ` (${input.mimeType})` : ""}.`,
  });
}

export async function isMediaBlockedOrQuarantined(url: string) {
  const store = await loadStore();
  return store.blockedMediaUrls.includes(url) || store.quarantinedMediaUrls.includes(url);
}
