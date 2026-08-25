import { config } from 'dotenv';
import '@testing-library/jest-dom';

config({ path: '.env.test' });

// Test-only fallback (not a secret): ensures a working JWT_SECRET even without a local
// .env.test (e.g. fresh clone, CI). A real .env.test value still overrides this.
process.env.JWT_SECRET ||= 'test-secret-value-at-least-32-bytes-long';
