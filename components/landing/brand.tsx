import Link from "next/link";

/* The wordmark: three rules shortening top to bottom, a list sorted down to
   what matters. */
export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 rounded-sm text-foreground ${className ?? ""}`} aria-label="Personal OS home">
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" focusable="false">
        <rect x="0.5" y="0.5" width="19" height="19" rx="5" className="fill-foreground" />
        <rect x="5" y="5.5" width="10" height="1.8" rx="0.9" className="fill-background" />
        <rect x="5" y="9.1" width="7" height="1.8" rx="0.9" className="fill-background" />
        <rect x="5" y="12.7" width="4" height="1.8" rx="0.9" className="fill-background" />
      </svg>
      <span className="text-heading-sm font-semibold">Personal OS</span>
    </Link>
  );
}
