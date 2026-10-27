'use client';
// components/settings/preferences-form.tsx — time zone, briefing time,
// working hours, lunch, reminders, speech output, motion and theme
// (FR-1101..FR-1106). Saved with optimistic concurrency; theme is a
// per-browser cookie read by the root layout's pre-paint script.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { cn } from '@/components/app/cn';
import { notify } from '@/components/app/toast';
import { ApiError, request } from '@/components/tasks/api';
import { inputCls } from '@/components/tasks/task-detail';
import type { MotionPreferenceName, PreferencesDTO } from './types';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  const m = typeof document !== 'undefined' ? document.cookie.match(/(?:^|; )theme=(light|dark)/) : null;
  return (m?.[1] as Theme) ?? 'system';
}

function applyTheme(t: Theme) {
  const d = document.documentElement;
  if (t === 'system') {
    document.cookie = 'theme=; Path=/; Max-Age=0; SameSite=Lax';
    d.removeAttribute('data-theme');
    d.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
  } else {
    document.cookie = `theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
    d.setAttribute('data-theme', t);
    d.classList.toggle('dark', t === 'dark');
  }
}

function zones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    list = [];
  }
  if (!list.includes('UTC')) list = ['UTC', ...list];
  return list.includes(current) ? list : [current, ...list];
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="text-body font-medium text-foreground">
          {label}
        </label>
        {hint && <p className="text-meta text-subtle-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-120 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        checked ? 'border-brand bg-brand' : 'border-border-strong bg-surface-2',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-surface shadow transition-transform duration-120', checked ? 'translate-x-[18px]' : 'translate-x-[3px]')} />
    </button>
  );
}

export function PreferencesForm({ initial }: { initial: PreferencesDTO }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [error, setError] = useState<string | null>(null);
  const zoneList = useMemo(() => zones(prefs.timeZone), [prefs.timeZone]);
  useEffect(() => setTheme(readTheme()), []);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const set = <K extends keyof PreferencesDTO>(k: K, v: PreferencesDTO[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const patch: Record<string, unknown> = { version: saved.version };
    for (const k of Object.keys(prefs) as (keyof PreferencesDTO)[]) {
      if (k !== 'version' && k !== 'locale' && k !== 'weekStart' && prefs[k] !== saved[k]) patch[k] = prefs[k];
    }
    try {
      const r = await request<{ preferences: PreferencesDTO }>('/api/preferences', { method: 'PATCH', json: patch });
      setPrefs(r.preferences);
      setSaved(r.preferences);
      notify({ title: 'Settings saved', tone: 'success' });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        setError('These settings changed in another tab. Reload to see the latest, then save again.');
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't save settings.");
      }
    } finally {
      setBusy(false);
    }
  };

  const time = (v: string | null) => v ?? '';
  const briefingTime = `${String(prefs.briefingHour).padStart(2, '0')}:${String(prefs.briefingMinute).padStart(2, '0')}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col"
    >
      <section aria-labelledby="pref-day" className="divide-y divide-border rounded-xl bg-surface px-4 shadow-card sm:px-5">
        <h2 id="pref-day" className="py-3.5 text-heading-sm text-foreground">
          Your day
        </h2>
        <Field label="Time zone" htmlFor="pref-tz" hint="Due dates, reminders and the briefing follow this zone.">
          <select id="pref-tz" className={cn(inputCls, 'max-w-xs')} value={prefs.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
            {zoneList.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="h-8 rounded-md px-2 text-body-sm text-brand hover:underline"
            onClick={() => set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone)}
          >
            Use this device&rsquo;s zone
          </button>
        </Field>
        <Field label="Morning briefing" htmlFor="pref-brief" hint="Prepared at this time each day.">
          <select
            id="pref-brief"
            className={cn(inputCls, 'w-32')}
            value={briefingTime}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              setPrefs((p) => ({ ...p, briefingHour: h, briefingMinute: m }));
            }}
          >
            {Array.from({ length: 8 }, (_, i) => i + 4).flatMap((h) =>
              [0, 15, 30, 45].filter((m) => h < 11 || m === 0).map((m) => {
                const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                return (
                  <option key={v} value={v}>
                    {v}
                  </option>
                );
              }),
            )}
          </select>
        </Field>
        <Field label="Working hours" hint="Used when scheduling and for “this afternoon”.">
          <label className="sr-only" htmlFor="pref-ws">
            Workday starts
          </label>
          <input id="pref-ws" type="time" className={cn(inputCls, 'w-32')} value={time(prefs.workdayStart)} onChange={(e) => set('workdayStart', e.target.value || null)} />
          <span className="text-body-sm text-subtle-foreground">to</span>
          <label className="sr-only" htmlFor="pref-we">
            Workday ends
          </label>
          <input id="pref-we" type="time" className={cn(inputCls, 'w-32')} value={time(prefs.workdayEnd)} onChange={(e) => set('workdayEnd', e.target.value || null)} />
        </Field>
        <Field label="Lunch ends at" htmlFor="pref-lunch" hint="“After lunch” means this time.">
          <input id="pref-lunch" type="time" className={cn(inputCls, 'w-32')} value={time(prefs.lunchEndsAt)} onChange={(e) => set('lunchEndsAt', e.target.value || null)} />
        </Field>
        <Field label="Reminder emails" htmlFor="pref-remind" hint="Email me when a task reminder is due.">
          <Toggle id="pref-remind" label="Reminder emails" checked={prefs.reminderEmailEnabled} onChange={(v) => set('reminderEmailEnabled', v)} />
        </Field>
      </section>

      <section aria-labelledby="pref-access" className="mt-6 divide-y divide-border rounded-xl bg-surface px-4 shadow-card sm:px-5">
        <h2 id="pref-access" className="py-3.5 text-heading-sm text-foreground">
          Voice and accessibility
        </h2>
        <Field label="Read results aloud" htmlFor="pref-speech" hint="Short spoken confirmations after commands. Email contents are never read aloud.">
          <Toggle id="pref-speech" label="Read results aloud" checked={prefs.speechOutputEnabled} onChange={(v) => set('speechOutputEnabled', v)} />
        </Field>
        <Field label="Motion" htmlFor="pref-motion">
          <select id="pref-motion" className={cn(inputCls, 'max-w-xs')} value={prefs.reducedMotion} onChange={(e) => set('reducedMotion', e.target.value as MotionPreferenceName)}>
            <option value="SYSTEM">Match my device</option>
            <option value="REDUCE">Reduce motion</option>
            <option value="FULL">Full motion</option>
          </select>
        </Field>
        <Field label="Theme" hint="Saved in this browser.">
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-border p-0.5">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
                className={cn('h-7 rounded px-3 text-body-sm capitalize', theme === t ? 'bg-surface-2 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {t === 'system' ? 'Device' : t}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-border bg-canvas/90 py-3 backdrop-blur-md">
        {error && (
          <p role="alert" className="mr-auto text-body-sm text-danger">
            {error}
          </p>
        )}
        {dirty && !error && <p className="mr-auto text-body-sm text-muted-foreground">Unsaved changes</p>}
        <button type="button" disabled={!dirty || busy} onClick={() => setPrefs(saved)} className="h-8 rounded-md px-3 text-body hover:bg-surface-2 disabled:opacity-50">
          Discard
        </button>
        <button type="submit" disabled={!dirty || busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50">
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Save changes
        </button>
      </div>
    </form>
  );
}
