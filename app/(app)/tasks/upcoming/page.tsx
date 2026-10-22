import { redirect } from 'next/navigation';
import { requirePageUser } from '@/lib/auth/session';

export default async function TasksUpcomingRedirect() {
  await requirePageUser();
  redirect('/upcoming');
}
