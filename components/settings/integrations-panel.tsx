"use client";
// components/settings/integrations-panel.tsx — Google connection status in
// plain language, what Personal OS may do, and disconnect (FR-1001..1004).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, CircleAlert, Mail, Minus } from "lucide-react";
import { cn } from "@/components/app/cn";
import { ConnectGoogleLink } from "@/components/app/connect-google-link";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { notify } from "@/components/app/toast";
import { ApiError, request } from "@/components/tasks/api";
import type { IntegrationDTO } from "./types";

const STATE_COPY: Record<
  IntegrationDTO["state"],
  { label: string; tone: "ok" | "warn" | "off" }
> = {
  connected: { label: "Connected", tone: "ok" },
  limited: { label: "Connected with limited access", tone: "warn" },
  needs_reconnect: { label: "Needs reconnecting", tone: "warn" },
  not_connected: { label: "Not connected", tone: "off" },
};

const SCOPES = ["Read email", "Create drafts", "Read calendar"];

export function IntegrationsPanel({ google }: { google: IntegrationDTO }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = STATE_COPY[google.state];
  const connected = google.state !== "not_connected";

  const disconnect = async () => {
    setBusy(true);
    try {
      await request("/api/integrations/google", { method: "DELETE" });
      notify({
        title: "Google disconnected",
        description: "Access was revoked and stored tokens deleted.",
        tone: "success",
      });
      setConfirm(false);
      router.refresh();
    } catch (e) {
      notify({
        title: "Couldn't disconnect Google",
        description:
          e instanceof ApiError ? e.message : "Try again in a moment.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="int-google"
      className="rounded-lg border border-border"
    >
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex -space-x-1" aria-hidden>
          <span className="grid size-9 place-items-center rounded-full border border-border bg-surface">
            <Mail className="size-4 text-subtle-foreground" />
          </span>
          <span className="grid size-9 place-items-center rounded-full border border-border bg-surface">
            <CalendarDays className="size-4 text-subtle-foreground" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="int-google" className="text-heading-sm text-foreground">
            Google — Gmail and Calendar
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-body-sm">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                copy.tone === "ok"
                  ? "bg-success"
                  : copy.tone === "warn"
                    ? "bg-warning"
                    : "bg-border-strong",
              )}
            />
            <span className="text-foreground">{copy.label}</span>
            {google.accountEmail && (
              <span className="truncate text-muted-foreground">
                · {google.accountEmail}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {google.state !== "connected" && (
            <ConnectGoogleLink className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-body font-medium text-brand-foreground hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {google.state === "not_connected"
                ? "Connect"
                : google.state === "limited"
                  ? "Grant access"
                  : "Reconnect"}
            </ConnectGoogleLink>
          )}
          {connected && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="h-8 rounded-md border border-border px-3 text-body text-foreground hover:bg-surface-2"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
      {google.state === "needs_reconnect" && (
        <p
          className="mx-4 mb-3 flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-body-sm text-foreground"
          role="status"
        >
          <CircleAlert aria-hidden className="size-4 text-warning" />
          Google stopped accepting our access. Reconnect to bring email and
          calendar back to your briefing.
        </p>
      )}
      <div className="border-t border-border px-4 py-3">
        <h3 className="mb-2 text-meta font-medium text-subtle-foreground">
          What Personal OS can do
        </h3>
        <ul className="grid gap-1.5 sm:grid-cols-3">
          {SCOPES.map((s) => {
            const granted = google.granted.includes(s);
            return (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-2 text-body-sm",
                  granted ? "text-foreground" : "text-subtle-foreground",
                )}
              >
                {granted ? (
                  <Check aria-hidden className="size-4 text-success" />
                ) : (
                  <Minus aria-hidden className="size-4" />
                )}
                {s}
                <span className="sr-only">
                  {granted ? ": allowed" : ": not allowed"}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-meta text-subtle-foreground">
          Personal OS never sends email. Drafts are created only after you
          confirm them, and stay in your Gmail Drafts folder.
        </p>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect Google?"
        description="Personal OS revokes its access and deletes the stored tokens. Your briefing will no longer include email or calendar. Your tasks are not affected."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        onConfirm={() => void disconnect()}
      />
    </section>
  );
}
