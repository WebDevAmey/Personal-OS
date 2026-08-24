import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns } from '@/db/schema';
import { buildToolRegistry, type ToolContext } from '@/lib/ai/tools';
import { checkRateLimit } from '@/lib/rate-limit';

const SYSTEM_PROMPT = `You are the command-bar assistant for a personal productivity app.
You can create/update/complete/delete/search the user's tasks, save/search their memories,
search their email, draft email replies, list their calendar (read-only), and search the web.
If a command is ambiguous (e.g. more than one task could match "the assignment"), call
search_tasks first and, if still ambiguous, ask the user ONE clarifying question instead of guessing.
Always end with a short, concrete confirmation of what you did (e.g. "Moved it to Friday.").`;

export async function runCommand(ctx: Omit<ToolContext, 'agentRunId'>, input: string): Promise<{ message: string }> {
  const { allowed } = await checkRateLimit(ctx.userId, 'ai');
  if (!allowed) {
    return { message: "You've hit the rate limit for commands — try again in a minute." };
  }

  const start = Date.now();
  const [run] = await db.insert(agentRuns).values({ userId: ctx.userId, input }).returning();

  const tools = buildToolRegistry({ ...ctx, agentRunId: run.id });

  const result = await generateText({
    model: anthropic('claude-sonnet-5'),
    system: SYSTEM_PROMPT,
    prompt: input,
    tools,
    stopWhen: stepCountIs(5),
  });

  await db.update(agentRuns).set({
    toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
    latencyMs: Date.now() - start,
    tokenCost: result.usage?.totalTokens ?? null,
  }).where(eq(agentRuns.id, run.id));

  return { message: result.text };
}
