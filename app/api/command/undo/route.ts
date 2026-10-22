// app/api/command/undo/route.ts — undo an executed command action by the
// taskEventId or batchId its response carried (docs/04 §9.3).
import { commandRoute } from '@/lib/commands/http';
import { handleUndo } from '@/lib/commands/service';

export function POST(req: Request): Promise<Response> {
  return commandRoute(req, (userId, body, meta) => handleUndo(userId, body, meta));
}
