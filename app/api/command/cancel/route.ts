// app/api/command/cancel/route.ts — cancel a pending proposal. Same as
// /api/command/confirm with decision "cancel".
import { getCommandDeps } from '@/lib/commands/deps';
import { commandRoute } from '@/lib/commands/http';
import { handleConfirm } from '@/lib/commands/service';

export function POST(req: Request): Promise<Response> {
  return commandRoute(req, (userId, body, meta) => {
    const proposalId = body && typeof body === 'object' ? (body as { proposalId?: unknown }).proposalId : undefined;
    return handleConfirm(userId, { proposalId, decision: 'cancel' }, getCommandDeps(), meta);
  });
}
