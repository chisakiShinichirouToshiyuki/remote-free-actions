import { randomBytes } from 'node:crypto';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import {
  CreateSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { RejectError, assertCanManageOrg, callerFromIdentity } from '../shared/org-auth';
import { env } from '$amplify/env/freee-connect';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });
const secrets = new SecretsManagerClient({});

const STATE_TTL_SECONDS = 10 * 60;

type FieldName = 'registerFreeeApp' | 'startFreeeAuthorize' | 'listOrgConnections';

// Amplify Gen2 custom operations deliver fieldName at the TOP LEVEL of the
// payload; the classic AppSync direct-resolver shape nests it under info.
// Accept both (unit mocks use info, the deployed runtime uses top-level).
interface Event {
  fieldName?: FieldName;
  info?: { fieldName: FieldName };
  arguments: { orgId?: string; label?: string; clientId?: string; clientSecret?: string; connectionId?: string };
  identity?: { sub?: string; groups?: string[] | null } | null;
}

async function listConnectionsByOrg(orgId: string) {
  const out = [];
  let nextToken: string | undefined;
  do {
    const { data, nextToken: nt } = await client.models.FreeeConnection.listFreeeConnectionByOrgId(
      { orgId },
      { nextToken },
    );
    out.push(...data);
    nextToken = nt ?? undefined;
  } while (nextToken);
  return out;
}

export const handler = async (event: Event) => {
  const caller = callerFromIdentity(event.identity);
  const a = event.arguments;

  const fieldName = event.fieldName ?? event.info?.fieldName;
  switch (fieldName) {
    case 'registerFreeeApp': {
      if (!a.orgId || !a.label || !a.clientId || !a.clientSecret) {
        throw new RejectError('orgId, label, clientId and clientSecret are required');
      }
      await assertCanManageOrg(client.models.Membership, caller, a.orgId);

      const existing = await listConnectionsByOrg(a.orgId);
      if (existing.some((c) => c.clientId === a.clientId)) {
        throw new RejectError('This freee app (clientId) is already registered in this org');
      }

      const { data: created, errors } = await client.models.FreeeConnection.create({
        orgId: a.orgId,
        label: a.label,
        clientId: a.clientId,
        status: 'needs_reauth', // connected になるのは callback で token を保存できた時
        tokenVersion: 0,
        createdBy: caller.sub,
        updatedBy: caller.sub,
      });
      if (!created || errors?.length) throw new RejectError('Failed to create connection');

      // Secret name is derived from the connection id (internal, not attacker
      // controlled). The secret holds ONLY the client_secret string.
      const secretName = `${env.SECRET_PREFIX}/connection/${created.id}/client-secret`;
      try {
        await secrets.send(new CreateSecretCommand({ Name: secretName, SecretString: a.clientSecret }));
      } catch (e) {
        if ((e as Error).name === 'ResourceExistsException') {
          await secrets.send(
            new PutSecretValueCommand({ SecretId: secretName, SecretString: a.clientSecret }),
          );
        } else {
          throw e;
        }
      }

      const { data: updated } = await client.models.FreeeConnection.update({
        id: created.id,
        secretArn: secretName, // name is a stable SecretId; full ARN not needed for GetSecretValue
        secretWrittenAt: new Date().toISOString(),
        updatedBy: caller.sub,
      });
      return updated;
    }

    case 'startFreeeAuthorize': {
      if (!a.connectionId) throw new RejectError('connectionId is required');
      const { data: conn } = await client.models.FreeeConnection.get({ id: a.connectionId });
      if (!conn) throw new RejectError('Connection not found');
      await assertCanManageOrg(client.models.Membership, caller, conn.orgId);

      const jti = randomBytes(32).toString('hex'); // 256-bit unguessable state
      const { errors } = await client.models.FreeeOAuthState.create({
        jti,
        connectionId: conn.id,
        ttl: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
        status: 'active',
        createdBy: caller.sub,
      });
      if (errors?.length) throw new RejectError('Failed to issue state nonce');

      const url = new URL('/public_api/authorize', env.FREEE_ACCOUNTS_ORIGIN);
      url.searchParams.set('client_id', conn.clientId);
      url.searchParams.set('redirect_uri', env.FREEE_CALLBACK_URL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', jti);
      return url.toString();
    }

    case 'listOrgConnections': {
      if (!a.orgId) throw new RejectError('orgId is required');
      await assertCanManageOrg(client.models.Membership, caller, a.orgId);
      const all = await listConnectionsByOrg(a.orgId);
      // Sanitized on purpose: cipher columns and secret references stay server-side.
      return all.map((c) => ({
        id: c.id,
        label: c.label,
        clientId: c.clientId,
        status: c.status ?? 'needs_reauth',
        secretWrittenAt: c.secretWrittenAt ?? null,
      }));
    }

    default:
      throw new RejectError('Unknown operation');
  }
};
