export function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new TypeError('Expected a fetch request URL');
}

export function requestBodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  throw new TypeError('Expected a text request body');
}
