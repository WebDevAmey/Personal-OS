import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SecurityPanel } from './security-panel';

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/settings/security',
  useSearchParams: () => new URLSearchParams(),
}));

const startRegistration = vi.fn();
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: (...a: unknown[]) => startRegistration(...a),
  startAuthentication: vi.fn(),
  WebAuthnError: class WebAuthnError extends Error {
    code = '';
  },
}));

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  startRegistration.mockReset().mockResolvedValue({ id: 'cred' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function bodyOf(call: number) {
  return JSON.parse(String(fetchMock.mock.calls[call][1]?.body));
}

describe('SecurityPanel passkey re-authentication', () => {
  it('asks for the password on REAUTH_REQUIRED and resends options with it', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: 'x', code: 'REAUTH_REQUIRED' }))
      .mockResolvedValueOnce(json(200, { challenge: 'c' }))
      .mockResolvedValueOnce(json(200, { verified: true }));
    render(<SecurityPanel passkeys={[]} email="demo@example.test" />);

    fireEvent.click(await screen.findByRole('button', { name: /add a passkey/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const pw = await screen.findByLabelText(/password for demo@example.test/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/enter your password/i);
    expect(startRegistration).not.toHaveBeenCalled();
    expect(bodyOf(0)).toEqual({});

    fireEvent.change(pw, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/passkey/register/options');
    expect(bodyOf(1)).toEqual({ password: 'correct horse' });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/passkey/register/verify');
  });

  it('keeps the password prompt open with an error when the password is wrong', async () => {
    fetchMock.mockImplementation(async () => json(401, { error: 'x', code: 'REAUTH_REQUIRED' }));
    render(<SecurityPanel passkeys={[]} email="demo@example.test" />);

    fireEvent.click(await screen.findByRole('button', { name: /add a passkey/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(await screen.findByLabelText(/password for/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/password isn.t right/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password for/i)).toHaveValue('');
    expect(startRegistration).not.toHaveBeenCalled();
  });
});
