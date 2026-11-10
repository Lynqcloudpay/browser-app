export async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers || {});
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const r = await fetch(url, { ...options, headers });
  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await r.text();
    throw new Error(`Server returned non-JSON response (${r.status} ${r.statusText}): ${text.slice(0, 120)}`);
  }
  return await r.json();
}

