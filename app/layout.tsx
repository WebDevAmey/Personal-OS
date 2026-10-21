import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CommandBar } from "@/components/command-bar/command-bar";
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
  title: "Personal OS - Your Day, Managed by One Command",
  description: "A personal operating system that reads your email, calendar, and tasks — then lets you manage everything through a single command bar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <CommandBar />
      </body>
    </html>
  );
}
