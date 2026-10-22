'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layers } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to send reset code');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">Check your email</h1>
            <p className="text-sm text-neutral-500">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
          </div>
          <Link
            href={`/reset-password?email=${encodeURIComponent(email)}`}
            className="inline-flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Enter code
          </Link>
          <Link href="/sign-in" className="block text-sm text-neutral-500 hover:text-neutral-900">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">Forgot password?</h1>
          <p className="text-sm text-neutral-500">
            Enter your email and we&apos;ll send you a reset code
          </p>
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset code'}
          </Button>
        </form>

        <Link href="/sign-in" className="block text-center text-sm text-neutral-500 hover:text-neutral-900">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
