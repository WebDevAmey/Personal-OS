import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/api/auth/signin');
  }

  return (
    <>
      <div className="flex justify-end px-8 pt-4 text-sm">
        <form
          action={async () => {
            'use server';
            await signOut();
          }}
        >
          <button type="submit" className="text-neutral-500 hover:text-neutral-900 transition-colors">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </>
  );
}
