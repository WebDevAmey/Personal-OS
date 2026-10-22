// app/(app)/layout.tsx — the signed-in app frame. requirePageUser redirects
// to /sign-in (keeping the path) when there is no valid session (AUTH-009).
import type { Metadata } from 'next';
import { AppShell } from '@/components/app/app-shell';
import { shellData } from './_lib/data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { template: '%s · Personal OS', default: 'Personal OS' },
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, counts, displayName } = await shellData();
  return (
    <AppShell session={session} counts={counts} displayName={displayName}>
      {children}
    </AppShell>
  );
}
