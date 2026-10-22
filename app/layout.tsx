import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal OS — your day, managed by one command",
  description:
    "Personal OS prepares a morning briefing from your tasks, Gmail and Google Calendar, and lets you capture, move and find things with one command bar, typed or spoken.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
};

/*
 * Runs before first paint (docs/07 §5.4). Reads the `theme` cookie
 * ("light" | "dark" | "system"); an explicit choice is written to
 * `data-theme`, and the resolved theme is mirrored as `.dark` so the shadcn
 * `dark:` variant works. Without JavaScript the CSS falls back to
 * `prefers-color-scheme` on its own.
 */
const THEME_SCRIPT = `(function(){try{var d=document.documentElement,m=document.cookie.match(/(?:^|; )theme=(light|dark)/),t=m?m[1]:"",q=matchMedia("(prefers-color-scheme: dark)");if(t)d.setAttribute("data-theme",t);var a=function(){d.classList.toggle("dark",t?t==="dark":q.matches)};a();if(!t)q.addEventListener("change",a)}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
