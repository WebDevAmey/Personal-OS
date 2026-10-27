import Link from "next/link";
import { Brand } from "./brand";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#safety", label: "Safety" },
  { href: "#faq", label: "FAQ" },
];

/* A floating pill above the hero. It sits on the dark dawn field at first and
   stays readable over the light sections below, so it carries its own
   surface instead of inheriting the page background. */
export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      <nav
        aria-label="Main"
        className="pointer-events-auto flex h-12 w-full max-w-3xl items-center justify-between gap-3 rounded-full bg-surface/95 pr-1.5 pl-4 shadow-popover backdrop-blur-md supports-[backdrop-filter]:bg-surface/85"
      >
        <Brand />
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-full px-3 py-1.5 text-body text-muted-foreground transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1">
          <Link
            href="/sign-in"
            className="rounded-full px-3 py-1.5 text-body font-medium text-foreground transition-colors duration-150 ease-out hover:bg-surface-2"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-foreground px-3.5 py-2 text-body font-medium text-background transition-[scale,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
