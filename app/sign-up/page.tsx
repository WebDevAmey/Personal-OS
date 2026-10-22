'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthButton, AuthDivider, AuthField, AuthNotice, AuthShell, authInputCls, authLinkCls } from '@/components/auth/auth-ui';

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Sign up failed');
        return;
      }

      router.push(`/verify-otp?type=SIGN_UP&email=${encodeURIComponent(email)}`);
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = () => {
    window.location.href = '/api/auth/google';
  };

  const handleGitHubSignUp = () => {
    window.location.href = '/api/auth/github';
  };

  return (
    <AuthShell
      title="Create your account"
      description="Get started with Personal OS."
      footer={
        <p>
          Already have an account?{' '}
          <Link href="/sign-in" className={authLinkCls}>
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthField id="email" label="Email">
          <input id="email" className={authInputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </AuthField>
        <AuthField id="password" label="Password" hint="At least 12 characters.">
          <input
            id="password"
            className={authInputCls}
            type="password"
            autoComplete="new-password"
            aria-describedby="password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </AuthField>
        <AuthButton type="submit" disabled={loading} loading={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </AuthButton>
      </form>

      <AuthDivider />
      <div className="flex flex-col gap-2.5">
        <AuthButton type="button" variant="secondary" onClick={handleGoogleSignUp}>
          Continue with Google
        </AuthButton>
        <AuthButton type="button" variant="secondary" onClick={handleGitHubSignUp}>
          Continue with GitHub
        </AuthButton>
      </div>
    </AuthShell>
  );
}
