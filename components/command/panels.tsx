'use client';
// components/command/panels.tsx — the palette's result states (docs/07 §11.1).
// Each state is distinct by icon + heading text + container, never colour alone.
import { useEffect, useState } from 'react';
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  ListChecks,
  Loader,
  Mail,
  ShieldAlert,
  Trash2,
  Undo2,
  RefreshCw,
  PencilLine,
} from 'lucide-react';
import { cn } from '@/components/app/cn';
import { Kbd } from '@/components/app/kbd';
import type { CommandResponse, ExecutedAction, Proposal } from './api';

type Of<K extends CommandResponse['kind']> = Extract<CommandResponse, { kind: K }>;

export function PendingPanel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-4 text-body text-muted-foreground">
      <Loader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  );
}

export function ClarificationPanel({
  response,
  onChoose,
  onRephrase,
}: {
  response: Of<'clarification'>;
  onChoose: (optionId: string) => void;
  onRephrase: () => void;
}) {
  const options = response.options.slice(0, 5);
  return (
    <section aria-labelledby="pal-clar-q" className="m-2 rounded-xl bg-surface-2/70 p-3">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
          <CircleHelp className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="pal-clar-q" className="text-heading-sm text-foreground">
            {response.question}
          </h3>
          {response.message && response.message !== response.question && (
            <p className="mt-0.5 text-body-sm text-muted-foreground">{response.message}</p>
          )}
        </div>
      </div>
      {/* Branches hang off a rail, like a decision tree: one question, numbered answers. */}
      <ol className="relative mt-3 ml-3.5 flex flex-col gap-1.5 pl-4" aria-label={`${options.length} options`}>
        <span aria-hidden className="absolute top-5 bottom-5 left-0 w-px bg-border-strong/35" />
        {options.map((o, i) => (
          <li key={o.id} className="relative">
            <span aria-hidden className="absolute top-1/2 -left-4 h-px w-4 bg-border-strong/35" />
            <button
              type="button"
              onClick={() => onChoose(o.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-surface py-2 pr-3 pl-2 text-left shadow-card transition-[box-shadow,scale] duration-150 ease-out hover:shadow-card-hover active:scale-[0.99]"
            >
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 font-mono text-meta text-muted-foreground">
                {i + 1}
              </span>
              <span className="sr-only">Option {i + 1}: </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-foreground">{o.label}</span>
                {o.detail && <span className="block truncate text-body-sm text-muted-foreground">{o.detail}</span>}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onRephrase}
            className="flex w-full items-center gap-3 rounded-xl py-2 pr-3 pl-3.5 text-left text-body text-muted-foreground transition-colors duration-150 ease-out hover:bg-surface hover:text-foreground"
          >
            <PencilLine aria-hidden className="size-4" />
            None of these — rephrase
            <Kbd className="ml-auto">Esc</Kbd>
          </button>
        </li>
      </ol>
      {response.allowFreeText && <p className="mt-2 pl-1 text-body-sm text-muted-foreground">Or type an answer above and press Enter.</p>}
    </section>
  );
}

const REASON_COPY: Record<string, string> = {
  destructive: 'Deletes something',
  bulk: 'Changes several items',
  external: 'Creates a Gmail draft',
  untrusted_source: 'Based on content from outside Personal OS',
  inferred_value: 'Includes a value Personal OS inferred',
};

function riskIcon(p: Proposal) {
  const tile = 'grid size-7 shrink-0 place-items-center rounded-lg';
  if (p.risk === 'DESTRUCTIVE') return <span aria-hidden className={cn(tile, 'bg-danger-subtle text-danger')}><Trash2 className="size-4" /></span>;
  if (p.risk === 'EXTERNAL') return <span aria-hidden className={cn(tile, 'bg-brand-subtle text-brand')}><Mail className="size-4" /></span>;
  if (p.risk === 'BULK') return <span aria-hidden className={cn(tile, 'bg-warning-subtle text-warning')}><ListChecks className="size-4" /></span>;
  return <span aria-hidden className={cn(tile, 'bg-surface-2 text-foreground')}><ShieldAlert className="size-4" /></span>;
}

function useMinutesLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

export function ProposalPanel({
  response,
  onDecide,
  confirmShortcut,
}: {
  response: Of<'proposal'>;
  onDecide: (d: 'confirm' | 'cancel') => void;
  confirmShortcut: string;
}) {
  const p = response.proposal;
  const minutes = useMinutesLeft(p.expiresAt);
  const expired = minutes <= 0;
  const destructive = p.risk === 'DESTRUCTIVE';
  const isDraft = p.risk === 'EXTERNAL';
  const changes = p.diff.length;
  return (
    <section aria-labelledby="pal-prop-h" className="m-2 rounded-xl bg-surface p-3.5 shadow-card">
      <div className="flex items-start gap-2.5">
        {riskIcon(p)}
        <div className="min-w-0 flex-1">
          <h3 id="pal-prop-h" className="text-heading-sm text-foreground">
            {isDraft ? 'Review this draft' : `Confirm ${changes > 1 ? `${changes} changes` : 'this change'}`}
          </h3>
          <p className="mt-0.5 text-body-sm text-muted-foreground">{p.summary}</p>
        </div>
      </div>
      {p.reasons.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Why confirmation is needed">
          {p.reasons.map((r) => (
            <li key={r} className="rounded-full bg-surface-2 px-2 py-0.5 text-meta text-muted-foreground">
              {REASON_COPY[r] ?? r}
              {r === 'untrusted_source' && p.taintSources?.length ? ` (${p.taintSources.join(', ')})` : ''}
            </li>
          ))}
        </ul>
      )}
      {changes > 0 && (
        <ul className="mt-3 max-h-56 divide-y divide-border overflow-y-auto rounded-lg bg-surface-2/60" aria-label="Changes">
          {p.diff.slice(0, isDraft ? 20 : 10).map((d, i) => (
            <li key={i} className="px-3 py-2 text-body-sm">
              <span className="text-muted-foreground">
                {d.entity}
                {d.field ? ` · ${d.field}` : ''}:{' '}
              </span>
              {isDraft ? (
                <span className="block whitespace-pre-wrap text-foreground">{d.after}</span>
              ) : (
                <>
                  {d.before !== null && (
                    <>
                      <del className="text-subtle-foreground">{d.before}</del>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> changes to </span>
                    </>
                  )}
                  <span className="font-medium text-foreground">{d.after ?? 'removed'}</span>
                </>
              )}
            </li>
          ))}
          {!isDraft && changes > 10 && <li className="px-3 py-2 text-body-sm text-muted-foreground">and {changes - 10} more</li>}
        </ul>
      )}
      {isDraft && <p className="mt-2 text-body-sm text-muted-foreground">Personal OS saves drafts to Gmail for you to send. It never sends email.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={expired}
          onClick={() => onDecide('confirm')}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-lg px-3 text-body font-medium transition-[scale,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97] disabled:opacity-50',
            destructive ? 'bg-danger text-white dark:text-background' : 'bg-foreground text-background',
          )}
        >
          {isDraft ? 'Save draft to Gmail' : destructive ? 'Delete' : 'Confirm'}
          <Kbd className="border-transparent bg-[color-mix(in_oklab,currentColor_18%,transparent)] text-current">{confirmShortcut}</Kbd>
        </button>
        <button type="button" onClick={() => onDecide('cancel')} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-body text-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-surface-2 active:scale-[0.97]">
          Cancel <Kbd>Esc</Kbd>
        </button>
        <span className="ml-auto text-meta text-subtle-foreground">{expired ? 'This expired — run the command again.' : `Expires in ${minutes} min`}</span>
      </div>
    </section>
  );
}

export function ExecutedPanel({
  response,
  undone,
  onUndo,
}: {
  response: Of<'executed'>;
  undone: string[];
  onUndo: (a: ExecutedAction) => void;
}) {
  return (
    <section aria-label="Done" className="px-2 py-2">
      {response.message && <p className="px-2 pb-1 text-body text-foreground">{response.message}</p>}
      <ul className="flex flex-col">
        {response.actions.map((a) => {
          const isUndone = undone.includes(a.proposalId);
          return (
            <li key={a.proposalId} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <CircleCheck aria-hidden className={cn('size-4 shrink-0', isUndone ? 'text-subtle-foreground' : 'text-success')} />
              <span className={cn('min-w-0 flex-1 text-body', isUndone && 'text-subtle-foreground line-through')}>{a.summary}</span>
              {isUndone ? (
                <span className="text-meta text-subtle-foreground">Undone</span>
              ) : a.undo ? (
                <button type="button" onClick={() => onUndo(a)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-foreground hover:bg-surface-2">
                  <Undo2 aria-hidden className="size-3.5" /> Undo
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AnswerPanel({ response }: { response: Of<'answer'> }) {
  return (
    <section aria-label="Answer" className="px-4 py-3">
      <p className="text-body whitespace-pre-wrap text-foreground">{response.message}</p>
      {response.sources && response.sources.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
          {response.sources.map((s, i) => (
            <li key={i}>
              {s.href ? (
                <a
                  href={s.href}
                  target={s.href.startsWith('/') ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-border px-1.5 text-meta text-muted-foreground hover:text-foreground"
                >
                  {s.label}
                  {!s.href.startsWith('/') && (
                    <>
                      <ExternalLink aria-hidden className="size-3" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </>
                  )}
                </a>
              ) : (
                <span className="inline-flex h-6 items-center rounded-sm border border-border px-1.5 text-meta text-muted-foreground">{s.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ErrorPanel({
  response,
  onRetry,
  onCapture,
}: {
  response: Of<'error'>;
  onRetry: () => void;
  onCapture: () => void;
}) {
  const { code, message, retryable } = response.error;
  const modelDown = code === 'MODEL_ERROR' || code === 'PROVIDER_UNAVAILABLE' || code === 'INTERNAL';
  return (
    <section role="alert" className="m-2 rounded-xl bg-danger-subtle p-3">
      <div className="flex items-start gap-2">
        <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <h3 className="text-heading-sm text-foreground">{code === 'RATE_LIMITED' ? 'Command limit reached' : "That didn't work"}</h3>
          <p className="mt-0.5 text-body-sm text-foreground">{message}</p>
          {modelDown && <p className="mt-0.5 text-body-sm text-muted-foreground">Quick capture (C) still works.</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(retryable || code === 'NETWORK') && code !== 'RATE_LIMITED' && (
          <button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-body hover:bg-surface-2">
            <RefreshCw aria-hidden className="size-3.5" /> Retry
          </button>
        )}
        {code === 'INTEGRATION_RECONNECT_REQUIRED' && (
          <a href="/settings/integrations" className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-body hover:bg-surface-2">
            Reconnect Google
          </a>
        )}
        {modelDown && (
          <button type="button" onClick={onCapture} className="inline-flex h-8 items-center rounded-md px-3 text-body hover:bg-surface">
            Use quick capture
          </button>
        )}
      </div>
    </section>
  );
}
