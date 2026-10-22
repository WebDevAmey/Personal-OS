// lib/tasks/repo.ts — the only entry point to task persistence (ADR-006).
//
// Contract for every export:
//  - first parameter is the acting user's id; every query is scoped by it, so
//    another user's ids behave exactly like ids that do not exist (NotFound,
//    nothing written);
//  - writes use updateMany({ where: { id, userId, version } }) and raise
//    ConflictError when the row changed since it was read;
//  - every mutation writes TaskEvent(s) in the same transaction, accepts a
//    MutationContext (source, operationId for idempotent replays, tx to join
//    a caller's transaction) and returns event ids usable as undo tokens.
//
// Errors: NotFoundError / ConflictError / ValidationError from lib/db/errors.

export {
  createTask,
  getTask,
  updateTask,
  completeTask,
  reopenTask,
  cancelTask,
  softDeleteTask,
  restoreTask,
  archiveTask,
  unarchiveTask,
  snoozeTask,
} from './repo/mutations';
export { listTasks, encodeCursor, decodeCursor } from './repo/views';
export { searchTasks, searchTasksByQuery, parseSearchQuery, findSimilarTasks, toPrefixQuery } from './repo/search';
export { addDependency, removeDependency, getTaskRelations, listSubtasks, type TaskRelations } from './repo/relations';
export {
  createReminder,
  rescheduleReminder,
  cancelReminder,
  markReminderSeen,
  getReminder,
  listReminders,
  claimReminderForDispatch,
  markReminderSent,
  markReminderFailed,
  listDueReminders,
  type CreateReminderInput,
  type ReminderResult,
} from './repo/reminders';
export { previewBulkUpdate, applyBulkUpdate, BULK_MAX } from './repo/bulk';
export {
  listTaskHistory,
  listActivity,
  undoEvent,
  undoBatch,
  purgeDeletedTasks,
  UNDO_WINDOW_MS,
  type HistoryPage,
  type UndoResult,
} from './repo/history';
export type { RecurrenceScope } from './repo/core';
export { NotFoundError, ConflictError, ValidationError, isRepoError } from '@/lib/db/errors';
export * from './types';
