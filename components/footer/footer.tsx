import Link from "next/link";
import { Brand } from "@/components/landing/brand";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "/sign-in", label: "Sign in" },
  { href: "/sign-up", label: "Get started" },
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Brand />
          <p className="text-body-sm text-muted-foreground">Tasks, Gmail and Calendar, managed by one command.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="rounded-sm text-body-sm text-muted-foreground transition-colors duration-[80ms] hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <p className="text-meta text-muted-foreground">© 2026 Personal OS. Figures built with the Anatomy kit (MIT).</p>
      </div>
    </footer>
  );
}
