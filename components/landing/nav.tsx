import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        <ul className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="rounded-sm text-body text-muted-foreground transition-colors duration-[80ms] hover:text-foreground">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "px-3 text-body")}>
            Sign in
          </Link>
          <Link href="/sign-up" className={cn(buttonVariants({ size: "lg" }), "px-3 text-body")}>
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
