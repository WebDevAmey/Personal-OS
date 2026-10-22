// app/api/command/route.ts — POST a natural-language command (docs/04 §9.1).
// Auth, CSRF, size cap and the error envelope live in lib/commands/http.
import { getCommandDeps } from '@/lib/commands/deps';
import { commandRoute } from '@/lib/commands/http';
import { handleCommand } from '@/lib/commands/service';

export const maxDuration = 30;

export function POST(req: Request): Promise<Response> {
  return commandRoute(req, (userId, body, meta) => handleCommand(userId, body, getCommandDeps(), meta));
}
