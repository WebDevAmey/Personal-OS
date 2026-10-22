'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthButton, AuthField, AuthLoading, AuthNotice, AuthShell, authInputCls } from '@/components/auth/auth-ui';

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'SIGN_UP';
  const email = searchParams.get('email') || '';

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      router.replace('/sign-up');
    } else if (type === 'PASSWORD_RESET') {
      // Reset codes are entered on the reset page together with the new
      // password (the API verifies and consumes them in one step).
      router.replace(`/reset-password?email=${encodeURIComponent(email)}`);
    }
  }, [email, type, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp, type: 'SIGN_UP' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }

      router.push('/sign-in?verified=true');
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Check your email"
      description={
        <>
          Enter the 6-digit code we sent to <strong className="font-medium text-foreground">{email}</strong>.
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
        <AuthField id="otp" label="Verification code">
          <input
            id="otp"
            className={`${authInputCls} h-12 text-center font-mono text-heading tracking-[0.5em]`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            required
          />
        </AuthField>
        <AuthButton type="submit" disabled={loading || otp.length !== 6} loading={loading}>
          {loading ? 'Verifying…' : 'Verify'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
