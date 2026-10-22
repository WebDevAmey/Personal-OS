// lib/ai/tools/cap.ts — output limits for tool results (docs/04 §13).
export const MAX_TOOL_OUTPUT_BYTES = 8192;
export const MAX_RUN_OUTPUT_BYTES = 32_768;

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Shrinks `items` until `render(items, truncated)` fits in the per-call
 * budget. Returns the rendered string.
 */
export function fitList<T>(items: T[], render: (items: T[], truncated: boolean) => string, max = MAX_TOOL_OUTPUT_BYTES): string {
  let n = items.length;
  let out = render(items, false);
  while (byteLength(out) > max && n > 0) {
    n = Math.max(0, Math.floor(n * 0.75));
    out = render(items.slice(0, n), true);
  }
  return byteLength(out) > max ? capString(out, max) : out;
}

/** Last-resort cut that keeps valid UTF-8. */
export function capString(value: string, max = MAX_TOOL_OUTPUT_BYTES): string {
  if (byteLength(value) <= max) return value;
  const buf = Buffer.from(value, 'utf8').subarray(0, max - 32);
  return `${buf.toString('utf8').replace(/�$/, '')}\n…[truncated]`;
}
