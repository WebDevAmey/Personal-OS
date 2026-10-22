'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthButton, AuthField, AuthLoading, AuthNotice, AuthShell, authInputCls } from '@/components/auth/auth-ui';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      router.replace('/forgot-password');
    }
  }, [email, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword: password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Reset failed');
        return;
      }

      router.push('/sign-in?reset=true');
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      description={
        <>
          Enter the 6-digit code sent to <strong className="font-medium text-foreground">{email}</strong> and choose a new password.
        </>
      }
      footer={
        <Link href="/sign-in" className="hover:text-foreground">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthField id="code" label="Reset code">
          <input
            id="code"
            className={`${authInputCls} h-12 text-center font-mono text-heading tracking-[0.5em]`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            required
          />
        </AuthField>
        <AuthField id="new-password" label="New password" hint="At least 12 characters.">
          <input
            id="new-password"
            className={authInputCls}
            type="password"
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </AuthField>
        <AuthField id="confirm-password" label="Confirm password">
          <input
            id="confirm-password"
            className={authInputCls}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </AuthField>
        <AuthButton type="submit" disabled={loading || code.length !== 6} loading={loading}>
          {loading ? 'Resetting…' : 'Reset password'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
