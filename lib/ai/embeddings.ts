// lib/ai/embeddings.ts — Voyage embeddings (voyage-3-lite, 512 dims).
// Bounded by a timeout; the error never includes the API key or input text.
export const EMBEDDING_TIMEOUT_MS = 3_000;

export async function embed(text: string): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('Voyage embedding is not configured');
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
    redirect: 'error',
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Voyage embedding request failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data[0].embedding as number[];
}
