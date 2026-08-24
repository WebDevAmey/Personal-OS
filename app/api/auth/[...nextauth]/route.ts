import { handlers } from '@/auth';

// auth.ts exports `handlers` (an object), not top-level GET/POST, so we
// destructure here rather than `export { GET, POST } from '@/auth'`.
export const { GET, POST } = handlers;
