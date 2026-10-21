'use client';

import Link from 'next/link';
import { Layers } from 'lucide-react';

const SOCIAL_LINKS = [
  {
    name: 'Twitter',
    href: '#',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
      </svg>
    ),
  },
  {
    name: 'GitHub',
    href: '#',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
        <path d="M9 18c-4.51 2-5-2-7-2"/>
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    href: '#',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
        <rect width="4" height="12" x="2" y="9"/>
        <circle cx="4" cy="4" r="2"/>
      </svg>
    ),
  },
];

const FOOTER_LINKS = {
  Product: [
    { name: 'Features', href: '#features' },
    { name: 'Integrations', href: '#' },
    { name: 'Pricing', href: '#' },
    { name: 'Changelog', href: '#' },
  ],
  Resources: [
    { name: 'Documentation', href: '#' },
    { name: 'API Reference', href: '#' },
    { name: 'Blog', href: '#' },
    { name: 'Community', href: '#' },
  ],
  Company: [
    { name: 'About', href: '#' },
    { name: 'Vision', href: '#' },
    { name: 'Contact', href: '#' },
    { name: 'Privacy Policy', href: '#' },
  ],
};

export function Footer() {
  return (
    <footer className="bg-[#131314] w-full text-white pt-8 lg:pt-12 overflow-hidden">
      <div className="px-4 sm:px-8 md:px-16 lg:px-28">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-6 gap-8 md:gap-12">
          {/* Left side - Logo and description */}
          <div className="lg:col-span-3 space-y-6">
            <Link href="/" className="block">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                  <Layers className="h-5 w-5 text-black" />
                </div>
                <span className="text-xl font-bold text-white">Personal OS</span>
              </div>
            </Link>
            <p className="text-sm/6 text-neutral-300 max-w-96">
              Your personal operating system. Manage tasks, emails, and calendar 
              through one AI-powered command bar.
            </p>
            <div className="flex gap-5 md:gap-6">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.name}
                  href={social.href}
                  className="text-white hover:text-gray-300 transition-colors"
                  aria-label={social.name}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Right side - Link columns */}
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-8 md:gap-12 lg:gap-28 items-start">
            {Object.entries(FOOTER_LINKS).map(([category, links]) => (
              <div key={category} className={category === 'Company' ? 'col-span-2 md:col-span-1' : ''}>
                <h3 className="font-medium text-sm mb-4">{category}</h3>
                <ul className="space-y-3 text-sm text-neutral-300">
                  {links.map((link) => (
                    <li key={link.name}>
                      <Link href={link.href} className="hover:text-neutral-400 transition-colors">
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="max-w-7xl mx-auto mt-12 pt-4 border-t border-neutral-700 flex justify-between items-center">
          <p className="text-neutral-400 text-sm">© 2026 Personal OS</p>
          <p className="text-sm text-neutral-400">All rights reserved.</p>
        </div>
      </div>

      {/* Large watermark text - full width */}
      <div className="relative w-full mt-6">
        <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl h-full max-h-64 bg-violet-500/30 rounded-full blur-[170px] pointer-events-none" />
        <h1 className="text-center font-extrabold leading-[0.7] text-transparent text-[clamp(4rem,18vw,18rem)] [-webkit-text-stroke:2px_#4c1d95] pb-4 select-none">
          Personal OS 
        </h1>
      </div>
    </footer>
  );
}
