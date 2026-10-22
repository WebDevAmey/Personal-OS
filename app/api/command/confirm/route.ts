// app/api/command/confirm/route.ts — confirm or cancel a pending proposal
// (docs/04 §9.2). The proposal id is the execution key: a retried confirm
// replays the stored result and never runs the action twice.
import { getCommandDeps } from '@/lib/commands/deps';
import { commandRoute } from '@/lib/commands/http';
import { handleConfirm } from '@/lib/commands/service';

export const maxDuration = 30;

export function POST(req: Request): Promise<Response> {
  return commandRoute(req, (userId, body, meta) => handleConfirm(userId, body, getCommandDeps(), meta));
}
