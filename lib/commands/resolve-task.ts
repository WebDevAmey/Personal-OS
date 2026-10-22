// lib/commands/resolve-task.ts — server-side entity resolution for task
// references ("the report", "it"), docs/04 §5.1 resolve_task and §8.2.
// Returns 0 / 1 / many candidates; the caller never guesses among many.
import { NotFoundError, OPEN_STATUSES, getTask, listTasks, searchTasks, type Task } from '@/lib/tasks/repo';
import { normalizeForSimilarity } from '@/lib/tasks/validation';
import { inUserInput, type RunState } from './run-state';

export const MAX_CANDIDATES = 5;

export type ResolveOutcome =
  | { match: 'none'; reason: 'no_match' | 'no_antecedent' }
  | { match: 'unique'; task: Task; userDerived: boolean }
  | { match: 'ambiguous'; tasks: Task[]; reason: 'ambiguous' | 'no_antecedent' };

const PRONOUNS = new Set(['', 'it', 'that', 'this', 'this one', 'that one', 'them', 'the task', 'task', 'the one', 'one']);

/** "the report" → "report"; "my dentist task" → "dentist". */
export function cleanReference(reference: string): string {
  return reference
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:the|my|a|an|that|this)\s+/, '')
    .replace(/\s+(?:task|todo|one)$/, '')
    .trim();
}

export function isPronoun(reference: string): boolean {
  const r = reference.toLowerCase().replace(/\s+/g, ' ').trim();
  return PRONOUNS.has(r) || PRONOUNS.has(cleanReference(r));
}

async function openTasksForAntecedent(state: RunState): Promise<Task[]> {
  const opts = { limit: MAX_CANDIDATES, now: state.now, timeZone: state.prefs.timeZone };
  const today = await listTasks(state.userId, { kind: 'today' }, opts);
  const overdue = await listTasks(state.userId, { kind: 'overdue' }, opts);
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const { task } of [...today.items, ...overdue.items]) {
    if (seen.has(task.id) || !(OPEN_STATUSES as readonly string[]).includes(task.status)) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out.slice(0, MAX_CANDIDATES);
}

function byDueThenRecent(a: Task, b: Task): number {
  const da = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return da - db || b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : 1);
}

export async function resolveTaskReference(state: RunState, reference: string, status: 'open' | 'any' = 'open'): Promise<ResolveOutcome> {
  const cleaned = cleanReference(reference);
  const pinned = state.pinned.get(cleaned) ?? state.pinned.get(reference.toLowerCase().trim());

  if (pinned) {
    const [task] = await searchById(state, pinned);
    if (task) return { match: 'unique', task, userDerived: true };
  }

  if (isPronoun(reference)) {
    const antecedent = state.focusedTaskId ? [state.focusedTaskId] : state.antecedentTaskIds;
    if (antecedent.length === 1) {
      const [task] = await searchById(state, antecedent[0]);
      if (task) return { match: 'unique', task, userDerived: true };
    }
    if (antecedent.length > 1) {
      const tasks = (await Promise.all(antecedent.slice(0, MAX_CANDIDATES).map((id) => searchById(state, id)))).flat();
      if (tasks.length > 0) return { match: 'ambiguous', tasks, reason: 'no_antecedent' };
    }
    const tasks = await openTasksForAntecedent(state);
    return tasks.length === 0 ? { match: 'none', reason: 'no_antecedent' } : { match: 'ambiguous', tasks, reason: 'no_antecedent' };
  }

  const page = await searchTasks(state.userId, {
    text: cleaned,
    limit: 25,
    now: state.now,
    timeZone: state.prefs.timeZone,
    filter: status === 'open' ? { status: [...OPEN_STATUSES] } : {},
  });
  const tasks = page.items.map((i) => i.task);
  if (tasks.length === 0) return { match: 'none', reason: 'no_match' };

  const want = normalizeForSimilarity(cleaned);
  const score = (t: Task) => {
    const title = normalizeForSimilarity(t.title);
    if (title === want) return 3;
    if (title.includes(want)) return 2;
    return 1;
  };
  const best = Math.max(...tasks.map(score));
  const top = tasks.filter((t) => score(t) === best).sort(byDueThenRecent);
  const userDerived = inUserInput(reference, state.input);
  if (top.length === 1) return { match: 'unique', task: top[0], userDerived };
  return { match: 'ambiguous', tasks: top.slice(0, MAX_CANDIDATES), reason: 'ambiguous' };
}

async function searchById(state: RunState, id: string): Promise<Task[]> {
  try {
    return [await getTask(state.userId, id)];
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}
