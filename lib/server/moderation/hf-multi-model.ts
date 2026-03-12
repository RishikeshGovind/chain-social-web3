/**
 * Hugging Face multi-model text moderation — all free, no credit card.
 *
 * Runs multiple HF Inference API models in parallel for broader coverage:
 *
 * 1. facebook/roberta-hate-speech-dynabench-r4-target — hate speech
 * 2. unitary/toxic-bert — multi-label toxicity (toxic, severe_toxic,
 *    obscene, threat, insult, identity_hate)
 * 3. KoalaAI/Text-Moderation — broader content moderation (S = sexual,
 *    H = hate, V = violence, HR = harassment, SH = self-harm, S3 = sexual/minors,
 *    H2 = hate/threatening, V2 = violence/graphic)
 *
 * All models are hosted free on HF serverless inference.
 * Token: https://huggingface.co → Settings → Access Tokens (read-only, email signup only)
 */

import { logger } from "@/lib/server/logger";
import type { SafetyDecision } from "@/lib/server/moderation/store";

export type MultiModelResult = {
  decision: SafetyDecision;
  labels: string[];
  reasons: string[];
};

type ModerateTextOptions = {
  timeoutMs?: number;
};

type ClassificationItem = { label: string; score: number };
type ClassificationOutput = ClassificationItem[][] | ClassificationItem[];

// ── Model definitions ───────────────────────────────────────────────

type ModelConfig = {
  id: string;
  interpret: (results: ClassificationItem[]) => {
    decision: SafetyDecision;
    labels: string[];
    reasons: string[];
  };
};

const HATE_SPEECH_MODEL: ModelConfig = {
  id: "facebook/roberta-hate-speech-dynabench-r4-target",
  interpret(results) {
    const hate = results.find((r) => r.label?.toLowerCase() === "hate");
    const score = hate?.score ?? 0;
    if (score >= 0.85)
      return {
        decision: "block",
        labels: ["hf:hate-speech"],
        reasons: [`Hate speech model: ${pct(score)} confidence`],
      };
    if (score >= 0.60)
      return {
        decision: "review",
        labels: ["hf:hate-speech"],
        reasons: [`Hate speech model: ${pct(score)} confidence`],
      };
    return { decision: "allow", labels: [], reasons: [] };
  },
};

const TOXIC_BERT_MODEL: ModelConfig = {
  id: "unitary/toxic-bert",
  interpret(results) {
    const labels: string[] = [];
    const reasons: string[] = [];
    let maxSeverity: SafetyDecision = "allow";

    for (const r of results) {
      const name = r.label?.toLowerCase() ?? "";
      const score = r.score ?? 0;

      // severe_toxic and threat are block-tier
      if (
        (name === "severe_toxic" || name === "threat") &&
        score >= 0.70
      ) {
        maxSeverity = "block";
        labels.push(`hf:toxic-bert:${name}`);
        reasons.push(`Toxic-BERT ${name}: ${pct(score)}`);
      }
      // identity_hate at high confidence is block
      else if (name === "identity_hate" && score >= 0.75) {
        maxSeverity = "block";
        labels.push(`hf:toxic-bert:${name}`);
        reasons.push(`Toxic-BERT ${name}: ${pct(score)}`);
      }
      // toxic, obscene, insult are review-tier
      else if (
        (name === "toxic" || name === "obscene" || name === "insult") &&
        score >= 0.70
      ) {
        if (maxSeverity !== "block") maxSeverity = "review";
        labels.push(`hf:toxic-bert:${name}`);
        reasons.push(`Toxic-BERT ${name}: ${pct(score)}`);
      }
    }
    return { decision: maxSeverity, labels, reasons };
  },
};

const TEXT_MODERATION_MODEL: ModelConfig = {
  id: "KoalaAI/Text-Moderation",
  interpret(results) {
    const labels: string[] = [];
    const reasons: string[] = [];
    let maxSeverity: SafetyDecision = "allow";

    // Label mapping for KoalaAI categories
    const blockCategories = new Set(["S3", "H2", "V2"]);
    const reviewCategories = new Set(["S", "H", "V", "HR", "SH"]);

    for (const r of results) {
      const cat = r.label?.trim() ?? "";
      const score = r.score ?? 0;

      if (blockCategories.has(cat) && score >= 0.60) {
        maxSeverity = "block";
        labels.push(`hf:moderation:${cat}`);
        reasons.push(`Content moderation ${describeCat(cat)}: ${pct(score)}`);
      } else if (reviewCategories.has(cat) && score >= 0.65) {
        if (maxSeverity !== "block") maxSeverity = "review";
        labels.push(`hf:moderation:${cat}`);
        reasons.push(`Content moderation ${describeCat(cat)}: ${pct(score)}`);
      }
    }
    return { decision: maxSeverity, labels, reasons };
  },
};

function describeCat(cat: string): string {
  const map: Record<string, string> = {
    S: "sexual",
    H: "hate",
    V: "violence",
    HR: "harassment",
    SH: "self-harm",
    S3: "sexual/minors",
    H2: "hate/threatening",
    V2: "violence/graphic",
  };
  return map[cat] ?? cat;
}

function pct(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}

// ── Shared inference call ───────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_HUGGINGFACE_TIMEOUT_MS ?? "3000",
  10,
);

function getApiToken(): string {
  return process.env.HUGGINGFACE_API_TOKEN?.trim() ?? "";
}

function getTimeoutMs(timeoutMs?: number): number {
  if (Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0) {
    return timeoutMs as number;
  }
  return Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0
    ? DEFAULT_TIMEOUT_MS
    : 3000;
}

async function callModel(
  modelId: string,
  text: string,
  token: string,
  timeoutMs?: number,
): Promise<ClassificationItem[] | null> {
  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs(timeoutMs));

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (response.status === 503) return null; // model loading
    if (!response.ok) {
      logger.warn("moderation.hf_model_error", {
        model: modelId,
        status: response.status,
      });
      return null;
    }

    const payload = (await response.json().catch(() => [])) as ClassificationOutput;
    // Normalize: some models return [[...]], some return [...]
    if (Array.isArray(payload?.[0]) && Array.isArray(payload[0])) {
      return payload[0] as ClassificationItem[];
    }
    if (Array.isArray(payload) && payload.length > 0 && "label" in (payload[0] as ClassificationItem)) {
      return payload as ClassificationItem[];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Decision merge ──────────────────────────────────────────────────

const DECISION_RANK: Record<SafetyDecision, number> = {
  allow: 0,
  review: 1,
  block: 2,
};

function mergeDecisions(
  results: Array<{ decision: SafetyDecision; labels: string[]; reasons: string[] }>,
): MultiModelResult {
  let finalDecision: SafetyDecision = "allow";
  const allLabels: string[] = [];
  const allReasons: string[] = [];

  for (const r of results) {
    if (DECISION_RANK[r.decision] > DECISION_RANK[finalDecision]) {
      finalDecision = r.decision;
    }
    allLabels.push(...r.labels);
    allReasons.push(...r.reasons);
  }

  return {
    decision: finalDecision,
    labels: [...new Set(allLabels)],
    reasons: [...new Set(allReasons)],
  };
}

// ── Public API ──────────────────────────────────────────────────────

const MODELS: ModelConfig[] = [
  HATE_SPEECH_MODEL,
  TOXIC_BERT_MODEL,
  TEXT_MODERATION_MODEL,
];

/**
 * Run text through all configured HF models in parallel.
 * Returns null if no API token is set.
 */
export async function moderateTextMultiModel(
  text: string,
  options?: ModerateTextOptions,
): Promise<MultiModelResult | null> {
  const token = getApiToken();
  if (!token) return null;

  const normalized = text.trim();
  if (!normalized || normalized.length < 3) return null;
  const truncated = normalized.slice(0, 5_000);

  // Fire all models in parallel — fastest possible
  const modelResults = await Promise.all(
    MODELS.map(async (model) => {
      const items = await callModel(model.id, truncated, token, options?.timeoutMs);
      if (!items) return null;
      return model.interpret(items);
    }),
  );

  const validResults = modelResults.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
  if (validResults.length === 0) return null;

  return mergeDecisions(validResults);
}
