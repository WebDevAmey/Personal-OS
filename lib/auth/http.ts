// lib/auth/http.ts
// Small helpers shared by the auth route handlers.
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

/** Trimmed, lower-cased email. All auth routes store and look up this form. */
export const EmailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email());

export async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function invalidInput(fields?: string[]): Response {
  // Field names only: Zod's messages and issue details are not returned
  // (SEC-B-024).
  return Response.json({ error: 'Invalid input', ...(fields?.length ? { fields } : {}) }, { status: 400 });
}

export function fieldNames(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))];
}

/**
 * Looks a user up by normalised email. Rows created before normalisation may
 * hold mixed-case addresses, so a case-insensitive match is the fallback.
 */
export async function findUserByEmail(email: string) {
  const exact = await prisma.user.findUnique({ where: { email } });
  if (exact) return exact;
  return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
}

export function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  return headers;
}
