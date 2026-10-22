// components/settings/types.ts — client-safe JSON shapes for preferences,
// memory and integrations (returned by /api/preferences, /api/memory,
// /api/integrations).

export type MotionPreferenceName = 'SYSTEM' | 'REDUCE' | 'FULL';

export interface PreferencesDTO {
  timeZone: string;
  locale: string;
  weekStart: number;
  briefingHour: number;
  briefingMinute: number;
  workdayStart: string | null;
  workdayEnd: string | null;
  lunchEndsAt: string | null;
  reminderEmailEnabled: boolean;
  speechOutputEnabled: boolean;
  reducedMotion: MotionPreferenceName;
  version: number;
}

export interface MemoryDTO {
  id: string;
  content: string;
  source: string;
  embedded: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export type IntegrationState = 'connected' | 'needs_reconnect' | 'limited' | 'not_connected';

export interface IntegrationDTO {
  provider: 'google';
  state: IntegrationState;
  accountEmail: string | null;
  /** Plain-language scope names: "Read email", "Create drafts", "Read calendar". */
  granted: string[];
  missing: string[];
  lastUsedAt: string | null;
}

export interface PasskeyDTO {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}
