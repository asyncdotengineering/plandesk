/**
 * The one loopback-host rule, for a bind address or a URL hostname: exactly
 * `127.0.0.1`, `localhost`, `::1` and `[::1]` (WHATWG URL keeps the brackets),
 * case-insensitive. A loopback bind grants owner trust without auth, so never
 * widen this to `0.0.0.0`, the rest of `127.0.0.0/8`, or LAN names.
 */
export function isLoopbackBind(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

/**
 * A file's `external_url` becomes a 302 on the Plan Desk origin, so only
 * `https:` (or `http:` to a loopback host) is allowed. Returns the normalized
 * href, or undefined for anything else (other schemes, relative,
 * protocol-relative, malformed). Userinfo is dropped: `https://good@evil/`
 * would otherwise show a trusted-looking host in front of the real one.
 */
export function safeExternalUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const allowed =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackBind(url.hostname));
  if (!allowed) return undefined;
  url.username = '';
  url.password = '';
  return url.href;
}
