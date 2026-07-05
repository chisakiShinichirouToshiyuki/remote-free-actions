import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { KMSClient } from '@aws-sdk/client-kms';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { kmsEncryptToken, validateExchangeResponse } from '../shared/freee-tokens';
import { env } from '$amplify/env/freee-oauth-callback';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });
const kms = new KMSClient({});
const secrets = new SecretsManagerClient({});

interface FnUrlEvent {
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
}

class CallbackError extends Error {}

/** One-time consumption: delete wins exactly once, replays find nothing. */
async function consumeState(jti: string): Promise<string> {
  const { data: consumed } = await client.models.FreeeOAuthState.delete({ jti });
  const fresh =
    consumed?.connectionId && (consumed.ttl ?? 0) > Math.floor(Date.now() / 1000);
  if (!fresh) throw new CallbackError('invalid, expired or replayed state');
  return consumed.connectionId as string;
}

async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(new URL('/public_api/token', env.FREEE_ACCOUNTS_ORIGIN), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new CallbackError(`freee token exchange failed (${res.status})`);
  return validateExchangeResponse((await res.json()) as Record<string, unknown>);
}

function html(status: number, message: string) {
  return {
    statusCode: status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><title>freee 連携</title><p>${message}</p>`,
  };
}

export const handler = async (event: FnUrlEvent) => {
  const code = event.queryStringParameters?.['code'];
  const state = event.queryStringParameters?.['state'];
  if (!code || !state) return html(400, '不正なリクエストです (code / state がありません)。');

  try {
    const connectionId = await consumeState(state);

    const { data: conn } = await client.models.FreeeConnection.get({ id: connectionId });
    if (!conn?.secretArn) throw new CallbackError('connection or client secret missing');

    const secret = await secrets.send(new GetSecretValueCommand({ SecretId: conn.secretArn }));
    if (!secret.SecretString) throw new CallbackError('client secret unreadable');

    // redirect_uri must match the authorize request — this Lambda's own URL.
    // Not in the typed $amplify env (setting a function's own Function URL as
    // its env would be circular in CFN); reconstructed from the Host header,
    // with a plain-env override for tests / future proxying.
    const host = event.headers?.['x-forwarded-host'] ?? event.headers?.['host'];
    const redirectUri = process.env.FREEE_CALLBACK_URL ?? (host ? `https://${host}/` : '');

    const tokens = await exchangeCode(code, conn.clientId, secret.SecretString, redirectUri);

    const [refreshCipher, accessCipher] = await Promise.all([
      kmsEncryptToken(kms, env.TOKEN_KMS_KEY_ARN, tokens.refresh_token, connectionId),
      kmsEncryptToken(kms, env.TOKEN_KMS_KEY_ARN, tokens.access_token, connectionId),
    ]);

    await client.models.FreeeConnection.update({
      id: connectionId,
      refreshTokenCipher: refreshCipher,
      accessTokenCipher: accessCipher,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: 'connected',
      tokenVersion: (conn.tokenVersion ?? 0) + 1,
      updatedBy: 'freee-oauth-callback',
    });

    return html(200, 'freee と接続しました。この画面は閉じて、元の画面に戻ってください。');
  } catch (e) {
    console.error('freee-oauth-callback failed', e);
    // No internals to the browser — the operator retries from the admin screen.
    return html(400, '接続に失敗しました。管理画面からやり直してください。');
  }
};
