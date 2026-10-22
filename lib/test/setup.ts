import { config } from 'dotenv';
import '@testing-library/jest-dom';

config({ path: '.env.test', quiet: true });

// Test-only fallbacks (not secrets): keep a fresh clone / CI working without a
// local .env.test. Real .env.test values still override these.
process.env.JWT_SECRET ||= 'test-secret-value-at-least-32-bytes-long';
process.env.NEXT_PUBLIC_APP_URL ||= 'http://localhost:3000';
process.env.EMAIL_TRANSPORT ||= 'memory';

// No test may reach a real provider by accident (docs/09 §2.1).
for (const key of ['ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'VOYAGE_API_KEY', 'RESEND_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  delete process.env[key];
}
