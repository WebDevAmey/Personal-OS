// lib/auth/webauthn.ts
export const RP_NAME = 'Personal OS';
export const ORIGIN = process.env.NEXT_PUBLIC_APP_URL!;
export const RP_ID = new URL(ORIGIN).hostname;
