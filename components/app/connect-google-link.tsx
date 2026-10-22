// components/app/connect-google-link.tsx — starts the Google OAuth flow.
// It must be a full-page navigation to the API route (which redirects to
// Google), so it is a plain anchor rather than next/link.
export const GOOGLE_CONNECT_HREF = '/api/auth/google';

export function ConnectGoogleLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <a href={GOOGLE_CONNECT_HREF} className={className}>
      {children}
    </a>
  );
}
