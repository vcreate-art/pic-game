/**
 * `crypto.randomUUID()` is only exposed in a secure context, so it is missing
 * whenever the app is served over plain HTTP on a LAN address — which is exactly
 * how people join from a phone on the same Wi-Fi. Calling it there throws, and
 * because the stroke id is minted on pointerdown, drawing failed silently.
 *
 * `crypto.getRandomValues()` carries no such restriction, so it backs the fallback.
 */
export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return uuidV4FromRandomValues();
}

/** RFC 4122 version 4, laid out by hand from 16 random bytes. */
export function uuidV4FromRandomValues(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
