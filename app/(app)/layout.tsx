import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/api/auth/signin');
  }

  return (
    <>
      <div className="flex justify-end px-8 pt-4 text-sm">
        <a href="/api/auth/signout" className="text-neutral-500 hover:text-neutral-900 transition-colors">
          Sign out
        </a>
      </div>
      {children}
    </>
  );
}
