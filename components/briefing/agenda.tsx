// components/briefing/agenda.tsx — today's schedule rail on Today (server
// component, streamed in Suspense). Reads Google Calendar through the
// integration capability; any failure becomes a plain message, never a crash.
import { CalendarDays, MapPin } from 'lucide-react';
import { getFreshAccessToken } from '@/lib/integrations/google/refresh-token';
import { createCalendarCapability } from '@/lib/integrations/calendar/client';
import { NeedsReconnectError } from '@/lib/integrations/errors';
import type { NormalizedEvent } from '@/lib/integrations/types';
import { logger } from '@/lib/observability/logger';
import type { IntegrationState } from '@/components/settings/types';

function timeLabel(e: NormalizedEvent, timeZone: string): string {
  if (e.allDay) return 'All day';
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  return `${fmt(e.start)} – ${fmt(e.end)}`;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="agenda-heading" className="rounded-lg border border-border bg-surface">
      <h2 id="agenda-heading" className="flex items-center gap-2 border-b border-border px-4 py-3 text-heading-sm text-foreground">
        <CalendarDays aria-hidden className="size-4 text-subtle-foreground" />
        Today&rsquo;s schedule
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function AgendaSkeleton() {
  return (
    <Frame>
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading schedule">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
        ))}
      </div>
    </Frame>
  );
}

export async function Agenda({ userId, timeZone, today, google }: { userId: string; timeZone: string; today: string; google: IntegrationState }) {
  if (google === 'not_connected') {
    return (
      <Frame>
        <p className="text-body-sm text-muted-foreground">Connect Google to see today&rsquo;s meetings next to your tasks.</p>
        <a href="/api/auth/google" className="mt-3 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body font-medium text-foreground hover:bg-surface-2">
          Connect Google
        </a>
      </Frame>
    );
  }
  if (google === 'needs_reconnect') {
    return (
      <Frame>
        <p className="text-body-sm text-muted-foreground">Google access expired.</p>
        <a href="/api/auth/google" className="mt-3 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body font-medium text-foreground hover:bg-surface-2">
          Reconnect Google
        </a>
      </Frame>
    );
  }

  let events: NormalizedEvent[];
  try {
    const token = await getFreshAccessToken(userId);
    const res = await createCalendarCapability(token).listEvents({ timeZone, startDate: today, endDate: today });
    events = res.events;
  } catch (e) {
    if (e instanceof NeedsReconnectError) {
      return (
        <Frame>
          <p className="text-body-sm text-muted-foreground">Google access expired.</p>
          <a href="/api/auth/google" className="mt-3 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body font-medium text-foreground hover:bg-surface-2">
            Reconnect Google
          </a>
        </Frame>
      );
    }
    logger.warn('today.agenda_failed', { errorName: (e as Error)?.name });
    return (
      <Frame>
        <p className="text-body-sm text-muted-foreground" role="status">
          Couldn&rsquo;t load your calendar right now. Reload to try again.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      {events.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">No events today.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-border-strong pl-3">
              <p className="tabular text-meta text-subtle-foreground">{timeLabel(e, timeZone)}</p>
              <p className="text-body text-foreground">{e.title || '(No title)'}</p>
              {e.location && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-meta text-subtle-foreground">
                  <MapPin aria-hidden className="size-3 shrink-0" />
                  {e.location}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Frame>
  );
}
