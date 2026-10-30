// lib/prisma.ts
import { PrismaClient } from './generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Neon's serverless driver only talks to Neon hosts, so any other Postgres
 * (local dev, CI, the test database) goes through node-postgres instead.
 */
export function isNeonUrl(connectionString: string): boolean {
  try {
    return new URL(connectionString).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

function createAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set');
  }
  return isNeonUrl(connectionString)
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function realClient(): PrismaClient {
  return (globalForPrisma.prisma ??= new PrismaClient({ adapter: createAdapter() }));
}

/**
 * Lazy proxy around the real client. `next build` imports every route module
 * while collecting page data, and the build environment has no DATABASE_URL —
 * instantiating at module load made the build fail before any page shipped.
 * The client is constructed on first property access instead, which only
 * happens at request time in the server runtime where env vars exist. The
 * result is cached on globalThis so dev HMR and warm serverless instances
 * reuse one connection pool.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = realClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
