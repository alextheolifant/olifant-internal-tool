import { randomBytes } from 'crypto';
import { encrypt, decrypt } from './crypto.util';

describe('crypto.util', () => {
  const originalKey = process.env.SP_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.SP_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a plaintext value', () => {
    const plaintext = 'Atzr|IwEBIExampleRefreshToken1234567890';
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-value';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('throws instead of decrypting when the ciphertext has been tampered with', () => {
    const ciphertext = encrypt('sensitive-token');
    const tampered = Buffer.from(ciphertext, 'base64');
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decrypt(tampered.toString('base64'))).toThrow();
  });

  it('throws when SP_TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.SP_TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow('SP_TOKEN_ENCRYPTION_KEY is not set');
  });

  it('throws when SP_TOKEN_ENCRYPTION_KEY is not 32 bytes', () => {
    process.env.SP_TOKEN_ENCRYPTION_KEY =
      Buffer.from('too-short').toString('base64');
    expect(() => encrypt('x')).toThrow('must decode to exactly 32 bytes');
  });
});
