'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { safeCallback } from '@/lib/auth/safe-callback';
import { AuthButton, AuthDivider, AuthField, AuthLoading, AuthNotice, AuthShell, authInputCls, authLinkCls } from '@/components/auth/auth-ui';
import { passkeysSupported, signInWithPasskey } from '@/components/settings/passkey';

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
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);

  useEffect(() => setCanPasskey(passkeysSupported()), []);

  const notice = searchParams.get('verified') === 'true' ? 'Email verified. Sign in to continue.' : searchParams.get('reset') === 'true' ? 'Password changed. Sign in with your new password.' : null;

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

  const handlePasskey = async () => {
    setError('');
    setPasskeyLoading(true);
    const r = await signInWithPasskey();
    setPasskeyLoading(false);
    if (r.ok) router.push(callbackUrl);
    else if (!r.cancelled) setError(r.message);
  };

  const handleGoogleSignIn = () => {
    window.location.href = '/api/auth/google';
  };

  const handleGitHubSignIn = () => {
    window.location.href = '/api/auth/github';
  };

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back to Personal OS."
      footer={
        <>
          <Link href="/forgot-password" className="hover:text-foreground">
            Forgot password?
          </Link>
          <p>
            Don&apos;t have an account?{' '}
            <Link href="/sign-up" className={authLinkCls}>
              Sign up
            </Link>
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {notice && !error && <AuthNotice tone="success">{notice}</AuthNotice>}
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {canPasskey && (
          <AuthButton type="button" variant="secondary" onClick={() => void handlePasskey()} loading={passkeyLoading} disabled={passkeyLoading || loading}>
            {!passkeyLoading && <KeyRound aria-hidden className="size-4" />}
            Sign in with a passkey
          </AuthButton>
        )}
      </div>
      {canPasskey && <AuthDivider />}

      <form onSubmit={handleSubmit} className={canPasskey ? 'flex flex-col gap-4' : 'mt-4 flex flex-col gap-4'}>
        <AuthField id="email" label="Email">
          <input id="email" className={authInputCls} type="email" autoComplete="email webauthn" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </AuthField>
        <AuthField id="password" label="Password">
          <input id="password" className={authInputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </AuthField>
        <AuthButton type="submit" disabled={loading || passkeyLoading} loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </AuthButton>
      </form>

      <AuthDivider />
      <div className="flex flex-col gap-2.5">
        <AuthButton type="button" variant="secondary" onClick={handleGoogleSignIn}>
          Continue with Google
        </AuthButton>
        <AuthButton type="button" variant="secondary" onClick={handleGitHubSignIn}>
          Continue with GitHub
        </AuthButton>
      </div>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <SignInForm />
    </Suspense>
  );
}
