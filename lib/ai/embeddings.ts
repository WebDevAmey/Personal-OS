export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embedding request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.data[0].embedding as number[];
}
