import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!); // use Neon's pooled connection string (the "-pooler" host) here, not the direct one
export const db = drizzle(sql, { schema });

export default db;
