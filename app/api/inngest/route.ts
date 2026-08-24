import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { dailyBriefingFn } from '@/inngest/daily-briefing';

export const { GET, POST, PUT } = serve({ client: inngest, functions: [dailyBriefingFn] });
