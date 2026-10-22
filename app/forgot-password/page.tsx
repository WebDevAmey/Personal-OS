'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthButton, AuthField, AuthNotice, AuthShell, authInputCls } from '@/components/auth/auth-ui';

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

  const back = (
    <Link href="/sign-in" className="hover:text-foreground">
      Back to sign in
    </Link>
  );

  if (success) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            If an account exists for <strong className="font-medium text-foreground">{email}</strong>, we sent it a 6-digit code.
          </>
        }
        footer={back}
      >
        <Link
          href={`/reset-password?email=${encodeURIComponent(email)}`}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-brand px-4 text-body font-medium text-brand-foreground hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Enter code
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" description="Enter your email and we’ll send you a reset code." footer={back}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthField id="email" label="Email">
          <input id="email" className={authInputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </AuthField>
        <AuthButton type="submit" disabled={loading} loading={loading}>
          {loading ? 'Sending…' : 'Send reset code'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
