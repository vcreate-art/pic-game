import { describe, expect, it } from 'vitest';
import { uuidV4FromRandomValues } from './uid.js';

// Guards the path taken when the app is served over plain HTTP on a LAN
// address, where crypto.randomUUID does not exist.
describe('uuidV4FromRandomValues', () => {
  it('produces a well-formed v4 uuid', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidV4FromRandomValues()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => uuidV4FromRandomValues()));
    expect(seen.size).toBe(500);
  });

  it('never calls crypto.randomUUID, so it works in a non-secure context', () => {
    const original = globalThis.crypto.randomUUID;
    // Simulate plain HTTP on a LAN address.
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(() => uuidV4FromRandomValues()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
