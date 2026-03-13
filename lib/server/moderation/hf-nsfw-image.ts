/**
 * Hugging Face NSFW image detection — free, no credit card.
 *
 * Uses Falconsai/nsfw_image_detection on HF Inference API.
 * This model classifies images as "nsfw" or "normal" and is
 * specifically trained for detecting sexually explicit images.
 *
 * Token: same HUGGINGFACE_API_TOKEN used for text moderation.
 */

import { logger } from "@/lib/server/logger";
import type { SafetyDecision } from "@/lib/server/moderation/store";

export type ImageModerationResult = {
  decision: SafetyDecision;
  labels: string[];
  reason: string | null;
};

type ClassificationItem = { label: string; score: number };
type ClassificationOutput = ClassificationItem[][] | ClassificationItem[];

const MODEL_ID =
  process.env.CHAINSOCIAL_HF_NSFW_MODEL?.trim() ||
  "Falconsai/nsfw_image_detection";

const INFERENCE_URL = `https://router.huggingface.co/hf-inference/models/${MODEL_ID}`;

const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.CHAINSOCIAL_HF_IMAGE_TIMEOUT_MS ?? "5000",
  10,
);

const NSFW_BLOCK_THRESHOLD = 0.80;
const NSFW_REVIEW_THRESHOLD = 0.50;

function getApiToken(): string {
  return process.env.HUGGINGFACE_API_TOKEN?.trim() ?? "";
}

function getTimeoutMs(): number {
  return Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0
    ? DEFAULT_TIMEOUT_MS
    : 5000;
}

/**
 * Moderate an image buffer using HF's free NSFW detection model.
 * Returns null if no token is configured or service is unavailable.
 */
export async function moderateImageWithHuggingFace(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<ImageModerationResult | null> {
  const token = getApiToken();
  if (!token) return null;

  // Only process image types the model understands
  const supportedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);
  if (!supportedTypes.has(input.mimeType)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    // HF image classification accepts raw binary with content-type
    const response = await fetch(INFERENCE_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": input.mimeType,
      },
      body: new Uint8Array(input.buffer),
    });

    if (response.status === 503) {
      logger.info("moderation.hf_nsfw_model_loading");
      return null;
    }

    if (!response.ok) {
      logger.warn("moderation.hf_nsfw_http_error", {
        status: response.status,
      });
      return null;
    }

    const payload = (await response
      .json()
      .catch(() => [])) as ClassificationOutput;

    // Normalize response format
    let results: ClassificationItem[];
    if (
      Array.isArray(payload) &&
      payload.length > 0 &&
      Array.isArray(payload[0])
    ) {
      results = payload[0] as ClassificationItem[];
    } else if (Array.isArray(payload)) {
      results = payload as ClassificationItem[];
    } else {
      return null;
    }

    if (results.length === 0) return null;

    const nsfwResult = results.find(
      (r) => r.label?.toLowerCase() === "nsfw",
    );
    const nsfwScore = nsfwResult?.score ?? 0;

    if (nsfwScore >= NSFW_BLOCK_THRESHOLD) {
      return {
        decision: "block",
        labels: ["hf:nsfw-image"],
        reason: `NSFW image detection: ${(nsfwScore * 100).toFixed(0)}% confidence`,
      };
    }

    if (nsfwScore >= NSFW_REVIEW_THRESHOLD) {
      return {
        decision: "review",
        labels: ["hf:nsfw-image"],
        reason: `NSFW image detection: ${(nsfwScore * 100).toFixed(0)}% confidence`,
      };
    }

    return { decision: "allow", labels: [], reason: null };
  } catch (error) {
    logger.warn("moderation.hf_nsfw_unavailable", { error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
