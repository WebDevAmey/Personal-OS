// lib/observability/logger.ts
// Structured JSON logger with key-based redaction. Never pass raw email
// bodies, tokens or passwords as fields: redaction is a safety net, not a
// licence to log sensitive values.

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|otp|code_verifier|refresh|access_?key|api_?key|session|body|html|snippet|embedding/i;
// Counts such as `tokens`, `inputTokens` or `tokenCount` are metrics, not credentials.
const METRIC_KEY = /^((input|output|total|prompt|completion)tokens|tokens|token(count|sused))$/i;
const TOKEN_LIKE = /\b(ya29\.[\w-]+|gh[pousr]_[\w]{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+|sk-[\w-]{16,})\b/g;
const MAX_STRING = 500;
const MAX_DEPTH = 5;

export const REDACTED = '[redacted]';

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const scrubbed = value.replace(TOKEN_LIKE, REDACTED);
    return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) && !METRIC_KEY.test(key) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[configured] ?? LEVELS.info;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => console.log(l)): Logger {
  const write = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < threshold()) return;
    const record = { ts: new Date().toISOString(), level, event, ...(redact({ ...base, ...fields }) as object) };
    sink(JSON.stringify(record));
  };
  return {
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

export const logger = createLogger();

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
