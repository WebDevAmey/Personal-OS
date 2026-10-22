// lib/briefing/types.ts — STUB (WS-6b). Owned by WS-5; this file only exists
// so the Today page compiles before the briefing workstream merges. At merge
// the WS-5 version replaces it; the UI depends only on the shapes below,
// which mirror the agreed contract.

export type BriefingSourceType = 'email' | 'event' | 'task' | 'memory';

export interface BriefingSource {
  type: BriefingSourceType;
  id: string;
  label: string;
}

export interface BriefingItem {
  id: string;
  kind: string;
  title: string;
  reason: string;
  priority: number;
  isInferred: boolean;
  sources: BriefingSource[];
  suggestedCommand?: string;
}

export interface TodayBriefingPayload {
  localDate: string;
  generatedAt: Date | string;
  isStale: boolean;
  partialSources: string[];
  items: BriefingItem[];
}

export type TodayBriefingStatus = 'ready' | 'preparing' | 'failed' | 'none';

export interface TodayBriefing {
  status: TodayBriefingStatus;
  briefing?: TodayBriefingPayload;
}
