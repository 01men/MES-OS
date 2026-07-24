const baseUrl = (process.env.MES_API_BASE_URL ?? 'http://127.0.0.1:3000/api/open/v1').replace(/\/$/, '');

export async function mesApi(
  path: string,
  options: { method?: string; body?: unknown; requestId?: string } = {},
) {
  const apiKey = process.env.MES_OPEN_API_KEY;
  if (!apiKey) throw new Error('MES_OPEN_API_KEY is not configured');
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-mes-api-key': apiKey,
      ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Preserve non-JSON error responses for diagnostics.
  }
  if (!response.ok) {
    throw new Error(`MES API ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}
