'use client';
// components/settings/security-panel.tsx — passkeys (list + add), sign out
// of this browser, and sign out everywhere (AUTH-005/006/008).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, LogOut, MonitorSmartphone, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { notify } from '@/components/app/toast';
import { inputCls } from '@/components/tasks/task-detail';
import { cn } from '@/components/app/cn';
import { passkeysSupported, registerPasskey } from './passkey';
import type { PasskeyDTO } from './types';

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never';
}

export function SecurityPanel({ passkeys, email }: { passkeys: PasskeyDTO[]; email: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<null | 'add' | 'out' | 'all'>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  useEffect(() => setSupported(passkeysSupported()), []);

  const add = async () => {
    setBusy('add');
    const r = await registerPasskey(name.trim() || undefined);
    setBusy(null);
    if (r.ok) {
      notify({ title: 'Passkey added', description: 'Other sessions were signed out for safety.', tone: 'success' });
      setAdding(false);
      setName('');
      router.refresh();
    } else if (!r.cancelled) {
      notify({ title: r.message, tone: 'error' });
    }
  };

  const signOut = async (everywhere: boolean) => {
    setBusy(everywhere ? 'all' : 'out');
    try {
      const res = await fetch(everywhere ? '/api/auth/sessions/revoke-all' : '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      router.replace('/sign-in');
      router.refresh();
    } catch {
      notify({ title: "Couldn't sign out", description: 'Check your connection and try again.', tone: 'error' });
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sec-passkeys" className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 id="sec-passkeys" className="text-heading-sm text-foreground">
              Passkeys
            </h2>
            <p className="text-body-sm text-muted-foreground">Sign in with your fingerprint, face or device PIN instead of a password.</p>
          </div>
          {supported && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-body text-foreground hover:bg-surface-2">
              <Plus aria-hidden className="size-4" /> Add a passkey
            </button>
          )}
        </div>
        {supported === false && <p className="px-4 pt-3 text-body-sm text-muted-foreground">This browser doesn&rsquo;t support passkeys.</p>}
        {adding && (
          <form
            className="flex flex-wrap items-center gap-2 border-b border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label htmlFor="passkey-name" className="sr-only">
              Passkey name
            </label>
            <input id="passkey-name" className={cn(inputCls, 'max-w-xs')} placeholder="Name, e.g. Work laptop" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" disabled={busy === 'add'} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50">
              {busy === 'add' && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Continue
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-md px-3 text-body hover:bg-surface-2">
              Cancel
            </button>
          </form>
        )}
        {passkeys.length === 0 ? (
          <p className="p-4 text-body-sm text-subtle-foreground">No passkeys yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-foreground">{p.name ?? (p.deviceType === 'multiDevice' ? 'Synced passkey' : 'Device passkey')}</p>
                  <p className="text-meta text-subtle-foreground">
                    Added {when(p.createdAt)} · Last used {when(p.lastUsedAt)}
                    {p.backedUp ? ' · Synced' : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sec-sessions" className="rounded-lg border border-border p-4">
        <h2 id="sec-sessions" className="text-heading-sm text-foreground">
          Sessions
        </h2>
        <p className="text-body-sm text-muted-foreground">Signed in as {email}.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void signOut(false)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-body text-foreground hover:bg-surface-2 disabled:opacity-50">
            <LogOut aria-hidden className="size-4" /> Sign out
          </button>
          <button type="button" disabled={busy !== null} onClick={() => setConfirmAll(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-body text-danger hover:bg-danger-subtle disabled:opacity-50">
            <MonitorSmartphone aria-hidden className="size-4" /> Sign out everywhere
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out on every device?"
        description="Every browser signed in to Personal OS, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        busy={busy === 'all'}
        onConfirm={() => void signOut(true)}
      />
    </div>
  );
}
