// Bedrock pricing per 1M tokens (from Anthropic official docs, verified 2026-04-03)
// Source: https://platform.claude.com/docs/en/about-claude/pricing
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude — newest first for substring matching priority
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-1": { input: 15.0, output: 75.0 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-opus": { input: 15.0, output: 75.0 },
  // Meta Llama
  "llama-4-maverick": { input: 0.34, output: 0.92 },
  "llama-4-scout": { input: 0.17, output: 0.46 },
  "llama-3-3-70b": { input: 0.72, output: 0.72 },
  "llama-3-2-90b": { input: 2.0, output: 2.0 },
  "llama-3-2-11b": { input: 0.16, output: 0.16 },
  "llama-3-1-405b": { input: 2.32, output: 2.32 },
  "llama-3-1-70b": { input: 0.72, output: 0.72 },
  "llama-3-1-8b": { input: 0.22, output: 0.22 },
  // Mistral
  "mistral-large": { input: 2.0, output: 6.0 },
  "mistral-small": { input: 0.1, output: 0.3 },
  // Amazon
  "nova-pro": { input: 0.8, output: 3.2 },
  "nova-lite": { input: 0.06, output: 0.24 },
  "nova-micro": { input: 0.035, output: 0.14 },
  "titan-text-express": { input: 0.2, output: 0.6 },
  "titan-text-lite": { input: 0.15, output: 0.2 },
  // Cohere
  "command-r-plus": { input: 2.5, output: 10.0 },
  "command-r": { input: 0.15, output: 0.6 },
};

// Default rate for unknown models (Sonnet-class)
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

// Cache pricing multipliers (5-min TTL — standard for Claude Code on Bedrock)
const CACHE_READ_MULTIPLIER = 0.10;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Calculate cost for a model invocation including cache tokens.
 * Matches model key against known pricing using substring matching.
 */
export function calculateCost(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): number {
  const key = modelKey.toLowerCase();
  const pricing =
    Object.entries(MODEL_PRICING).find(([k]) => key.includes(k))?.[1] ??
    DEFAULT_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.input * CACHE_READ_MULTIPLIER +
    (cacheWriteTokens / 1_000_000) * pricing.input * CACHE_WRITE_MULTIPLIER
  );
}
