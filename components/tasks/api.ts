// components/tasks/api.ts — browser client for the task/project routes.
import type { ApiErrorBody, LocalDateTime, ProjectDTO, TaskDetailDTO, TaskDTO, TaskEventDTO, TaskPageDTO } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error);
    this.name = 'ApiError';
  }
  get isConflict() {
    return this.status === 409;
  }
}

export async function request<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...rest,
      headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, { error: "Couldn't reach Personal OS. Check your connection.", code: 'NETWORK' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body as ApiErrorBody) ?? { error: 'Something went wrong on our side.', code: 'INTERNAL' });
  }
  return body as T;
}

export interface MutationResult {
  task: TaskDTO;
  undoEventId: string | null;
  batchId?: string;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: 'INBOX' | 'TODO' | 'IN_PROGRESS';
  priority?: number;
  due?: LocalDateTime | null;
  start?: LocalDateTime | null;
  estimateMinutes?: number | null;
  projectId?: string | null;
  parentId?: string | null;
  tags?: string[];
  recurrenceRule?: string | null;
}

export const tasksApi = {
  list: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return request<TaskPageDTO>(`/api/tasks?${q}`);
  },
  detail: (id: string) => request<TaskDetailDTO>(`/api/tasks/${encodeURIComponent(id)}`),
  history: (id: string, cursor?: string) =>
    request<{ events: TaskEventDTO[]; nextCursor: string | null }>(`/api/tasks/${encodeURIComponent(id)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  create: (body: ({ title: string } & TaskPatch) | { capture: string; source?: 'MANUAL' | 'VOICE' }) =>
    request<{ task: TaskDTO; undoEventId: string | null; similar: { id: string; title: string }[]; unknownProject: string | null }>('/api/tasks', { method: 'POST', json: body }),
  update: (id: string, version: number, patch: TaskPatch) =>
    request<MutationResult>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', json: { version, ...patch } }),
  remove: (id: string, version?: number) =>
    request<MutationResult>(`/api/tasks/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`, { method: 'DELETE' }),
  action: (id: string, body: { action: 'complete' | 'reopen' | 'cancel' | 'restore'; version?: number; completeSubtasks?: boolean } | { action: 'snooze'; until: LocalDateTime | null; version?: number }) =>
    request<MutationResult & { warnings?: string[] }>(`/api/tasks/${encodeURIComponent(id)}/actions`, { method: 'POST', json: body }),
  undo: (token: { eventId: string } | { batchId: string }, scope: 'recent' | 'history' = 'recent') =>
    request<{ tasks: TaskDTO[] }>('/api/tasks/undo', { method: 'POST', json: { ...token, scope } }),
  bulkPreview: (ids: string[], change: Record<string, unknown>) =>
    request<{ count: number; titles: string[]; expected: { id: string; version: number }[] }>('/api/tasks/bulk', { method: 'POST', json: { ids, change, mode: 'preview' } }),
  bulkApply: (ids: string[], change: Record<string, unknown>, expected?: { id: string; version: number }[]) =>
    request<{ batchId: string; tasks: TaskDTO[] }>('/api/tasks/bulk', { method: 'POST', json: { ids, change, mode: 'apply', expected } }),
  addDependency: (id: string, dependsOnId: string) =>
    request<{ undoEventId: string | null }>(`/api/tasks/${encodeURIComponent(id)}/dependencies`, { method: 'POST', json: { dependsOnId } }),
  removeDependency: (id: string, dependsOnId: string) =>
    request<{ undoEventId: string | null }>(`/api/tasks/${encodeURIComponent(id)}/dependencies?dependsOnId=${encodeURIComponent(dependsOnId)}`, { method: 'DELETE' }),
  addReminder: (id: string, at: LocalDateTime) => request<unknown>(`/api/tasks/${encodeURIComponent(id)}/reminders`, { method: 'POST', json: { at } }),
  removeReminder: (id: string, reminderId: string) =>
    request<unknown>(`/api/tasks/${encodeURIComponent(id)}/reminders?reminderId=${encodeURIComponent(reminderId)}`, { method: 'DELETE' }),
};

export const projectsApi = {
  list: () => request<{ projects: ProjectDTO[] }>('/api/projects'),
  create: (name: string) => request<{ project: ProjectDTO }>('/api/projects', { method: 'POST', json: { name } }),
  update: (id: string, version: number, patch: { name?: string; description?: string | null; archived?: boolean }) =>
    request<{ project: ProjectDTO }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', json: { version, ...patch } }),
  remove: (id: string, version: number) => request<{ project: ProjectDTO }>(`/api/projects/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }),
};
