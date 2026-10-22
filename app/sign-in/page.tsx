'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layers } from 'lucide-react';
import { safeCallback } from '@/lib/auth/safe-callback';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The raw callbackUrl is never navigated to: only the validated, normalised
  // same-origin path is (SEC-B-011, SEC-R-002). Anything else becomes /today.
  const callbackUrl = safeCallback(searchParams.get('callbackUrl'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      router.push(safeCallback(callbackUrl));
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    window.location.href = '/api/auth/google';
  };

  const handleGitHubSignIn = () => {
    window.location.href = '/api/auth/github';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">Sign in</h1>
          <p className="text-sm text-neutral-500">Welcome back to Personal OS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-neutral-500">or</span>
          </div>
        </div>

        <div className="space-y-3">
          <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
            Continue with Google
          </Button>
          <Button variant="outline" className="w-full" onClick={handleGitHubSignIn}>
            Continue with GitHub
          </Button>
        </div>

        <div className="space-y-2 text-center text-sm">
          <Link href="/forgot-password" className="text-neutral-500 hover:text-neutral-900">
            Forgot password?
          </Link>
          <p className="text-neutral-500">
            Don&apos;t have an account?{' '}
            <Link href="/sign-up" className="font-medium text-neutral-900 hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-neutral-500">Loading...</div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}
