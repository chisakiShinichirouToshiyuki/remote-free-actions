// Token material handling shared by the OAuth callback and the bridge.
//
// OAuth token strings from freee are validated against a strict shape before
// they are encrypted, persisted or used — a malformed/hostile exchange
// response must never reach KMS or DynamoDB (also the taint barrier for
// analyzers). Ciphertext is bound to its connection via EncryptionContext, so
// a ciphertext copied onto another row fails to decrypt.

import { DecryptCommand, EncryptCommand, type KMSClient } from '@aws-sdk/client-kms';

const TOKEN_SHAPE = /^[\x21-\x7e]{16,4096}$/;

export class TokenError extends Error {}

export function assertTokenLike(value: unknown, name: string): string {
  if (typeof value !== 'string' || !TOKEN_SHAPE.test(value)) {
    throw new TokenError(`freee returned a malformed ${name}`);
  }
  return value;
}

export function assertExpiresIn(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 3600) {
    throw new TokenError('freee returned a malformed expires_in');
  }
  return n;
}

export async function kmsEncryptToken(
  kms: KMSClient,
  keyArn: string,
  plaintext: string,
  connectionId: string,
): Promise<string> {
  const out = await kms.send(
    new EncryptCommand({
      KeyId: keyArn,
      Plaintext: Buffer.from(plaintext, 'utf8'),
      EncryptionContext: { connectionId },
    }),
  );
  if (!out.CiphertextBlob) throw new TokenError('KMS encrypt returned no ciphertext');
  return Buffer.from(out.CiphertextBlob).toString('base64');
}

export async function kmsDecryptToken(
  kms: KMSClient,
  cipherB64: string,
  connectionId: string,
): Promise<string> {
  const out = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(cipherB64, 'base64'),
      EncryptionContext: { connectionId },
    }),
  );
  if (!out.Plaintext) throw new TokenError('KMS decrypt returned no plaintext');
  return Buffer.from(out.Plaintext).toString('utf8');
}

export type TokenExchangeResult = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export function validateExchangeResponse(raw: Record<string, unknown>): TokenExchangeResult {
  return {
    access_token: assertTokenLike(raw.access_token, 'access_token'),
    refresh_token: assertTokenLike(raw.refresh_token, 'refresh_token'),
    expires_in: assertExpiresIn(raw.expires_in),
  };
}
