import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { briefingFunctions } from '@/inngest/daily-briefing';
import { retentionFunctions } from '@/inngest/retention';

// Requests are verified with INNGEST_SIGNING_KEY (read by the client from the env). The SDK runs in cloud mode
// (signature required) unless INNGEST_DEV is set, which must never be the
// case in Production/Preview (docs/05 §8).
const functions = [...briefingFunctions, ...retentionFunctions];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
