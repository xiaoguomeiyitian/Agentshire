/**
 * Lightweight token estimation for when LLM API providers return usage = 0.
 *
 * Uses a heuristic similar to group-chat-context.ts:
 *   - CJK characters: ~1.5 tokens per char (each CJK char ≈ 1-2 tokens)
 *   - Latin/other: ~4 chars per token (≈ 0.25 tokens per char)
 *
 * This is NOT a real tokenizer (like tiktoken/gpt-tokenizer). It gives a
 * rough estimate sufficient for display purposes. The error margin is
 * typically ±15-20% compared to actual tokenizer counts.
 *
 * For accurate billing, rely on the API's own usage field when available.
 */

/** Coerce any content value to a string for token estimation. */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return String((item as any).text ?? (item as any).content ?? "");
      }
      return String(item ?? "");
    }).join("");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return String(content ?? "");
}

/** Estimate token count for a single string. */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== "string") return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) ?? []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.5 + other / 4);
}

/**
 * Estimate input tokens from llm_input hook payload fields.
 * Combines systemPrompt + prompt + historyMessages.
 */
export function estimateInputTokens(
  systemPrompt: string,
  prompt: string,
  historyMessages: Array<{ role?: string; content?: unknown }> = [],
): number {
  let total = estimateTokens(systemPrompt) + estimateTokens(prompt);
  // Each message has ~4 tokens overhead for role/structure framing
  total += historyMessages.length * 4;
  for (const msg of historyMessages) {
    total += estimateTokens(contentToString(msg.content));
  }
  return total;
}

/**
 * Estimate output tokens from llm_output hook payload.
 * Sums all assistantTexts.
 */
export function estimateOutputTokens(assistantTexts: string[] = []): number {
  let total = 0;
  for (const text of assistantTexts) {
    total += estimateTokens(typeof text === "string" ? text : contentToString(text));
  }
  return total;
}

/**
 * If the API-provided usage has both input and output as 0 (or undefined),
 * return estimated values. Otherwise, return the original usage.
 */
export function withEstimatedFallback(
  apiUsage: { input: number; output: number } | undefined,
  estimatedInput: number,
  estimatedOutput: number,
): { input: number; output: number } {
  const apiInput = apiUsage?.input ?? 0;
  const apiOutput = apiUsage?.output ?? 0;
  if (apiInput === 0 && apiOutput === 0) {
    return { input: estimatedInput, output: estimatedOutput };
  }
  return { input: apiInput, output: apiOutput };
}
