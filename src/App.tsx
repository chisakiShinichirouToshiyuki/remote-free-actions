import { useCallback, useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { GptSetupGuide } from './GptSetupGuide';

const client = generateClient<Schema>();

type OrgRow = Schema['Org']['type'];
type MemberRow = Schema['Membership']['type'];
type ConnRow = {
  id: string;
  label: string;
  clientId: string;
  status: string;
  secretWrittenAt: string | null;
};

type Me = {
  sub: string;
  isAppAdmin: boolean;
  orgId: string | null;
  role: string | null;
};

async function loadMe(): Promise<Me> {
  const session = await fetchAuthSession();
  const sub = session.tokens?.accessToken.payload.sub as string;
  const groups = (session.tokens?.accessToken.payload['cognito:groups'] ?? []) as string[];
  const { data: membership } = await client.models.Membership.get({ userSub: sub });
  return {
    sub,
    isAppAdmin: groups.includes('app-admin'),
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  };
}

function useAsyncError(): [string | null, (fn: () => Promise<void>) => Promise<void>] {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  return [error, run];
}

const box: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 12,
  margin: '8px 0',
};
const errStyle: React.CSSProperties = { color: '#c40', whiteSpace: 'pre-wrap' };

function throwIfErrors(errors: { message: string }[] | undefined | null) {
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('\n'));
}

// ---------------------------------------------------------------------------
// org-admin: freee アプリ登録 → 認可 → メンバー割当

function ConnectionsPanel({ me }: { me: Me }) {
  const orgId = me.orgId;
  const [conns, setConns] = useState<ConnRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, run] = useAsyncError();
  const [form, setForm] = useState({ label: '', clientId: '', clientSecret: '' });
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const { data, errors } = await client.queries.listOrgConnections({ orgId });
    throwIfErrors(errors as { message: string }[] | undefined);
    setConns((typeof data === 'string' ? JSON.parse(data) : data) as ConnRow[]);
    const m = await client.models.Membership.listMembershipByOrgId({ orgId });
    setMembers(m.data);
    setRefreshKey((k) => k + 1); // ConnectionCard の grants effect を再発火させる
  }, [orgId]);

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  if (!orgId) return <p style={{ margin: '2rem' }}>組織に所属していません(app-admin にメンバー登録を依頼)。</p>;

  async function register() {
    await run(async () => {
      const { errors } = await client.mutations.registerFreeeApp({ orgId: orgId as string, ...form });
      throwIfErrors(errors as { message: string }[] | undefined);
      setForm({ label: '', clientId: '', clientSecret: '' });
      await reload();
    });
  }

  async function authorize(connectionId: string) {
    await run(async () => {
      const { data, errors } = await client.mutations.startFreeeAuthorize({ connectionId });
      throwIfErrors(errors as { message: string }[] | undefined);
      if (data) window.open(data, '_blank', 'noopener');
    });
  }

  async function grant(connectionId: string, userSub: string) {
    await run(async () => {
      const { errors } = await client.mutations.grantConnection({ connectionId, userSub });
      throwIfErrors(errors as { message: string }[] | undefined);
      await reload();
    });
  }

  return (
    <main style={{ maxWidth: 820, margin: '1rem auto', fontFamily: 'system-ui' }}>
      <h2>freee アプリ接続(org-admin)</h2>
      {error && <p style={errStyle}>{error}</p>}

      <div style={box}>
        <h3>アプリを登録</h3>
        <p style={{ fontSize: 13, color: '#666' }}>
          freee アプリストアで作成したアプリの client_id / client_secret を登録。secret は
          Secrets Manager にのみ保存されます。freee 側のコールバック URL には GPTs
          設定ガイド記載の freeeCallbackUrl を登録してください。
        </p>
        <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <input
            placeholder="表示名(例: 会計 / 顧問先A)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <input
            placeholder="client_id"
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
          />
          <input
            placeholder="client_secret"
            type="password"
            value={form.clientSecret}
            onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
          />
          <button
            type="button"
            onClick={register}
            disabled={!form.label || !form.clientId || !form.clientSecret}
          >
            登録
          </button>
        </div>
      </div>

      <h3>接続一覧</h3>
      {conns.length === 0 && <p>まだ接続がありません。</p>}
      {conns.map((c) => (
        <ConnectionCard
          key={c.id}
          conn={c}
          refreshKey={refreshKey}
          members={members}
          onAuthorize={authorize}
          onGrant={grant}
          onChanged={() => void run(reload)}
        />
      ))}
    </main>
  );
}

function ConnectionCard({
  conn,
  refreshKey,
  members,
  onAuthorize,
  onGrant,
  onChanged,
}: {
  conn: ConnRow;
  refreshKey: number;
  members: MemberRow[];
  onAuthorize: (id: string) => void;
  onGrant: (connectionId: string, userSub: string) => void;
  onChanged: () => void;
}) {
  const [grants, setGrants] = useState<Schema['UserConnection']['type'][]>([]);
  const [selected, setSelected] = useState('');

  const reloadGrants = useCallback(async () => {
    const { data } = await client.models.UserConnection.list({
      filter: { connectionId: { eq: conn.id } },
    });
    setGrants(data);
  }, [conn.id]);

  useEffect(() => {
    let alive = true;
    client.models.UserConnection.list({ filter: { connectionId: { eq: conn.id } } }).then(
      ({ data }) => {
        if (alive) setGrants(data);
      },
    );
    return () => {
      alive = false;
    };
  }, [conn.id, refreshKey]);

  async function revoke(userSub: string) {
    await client.mutations.revokeConnection({ connectionId: conn.id, userSub });
    await reloadGrants();
    onChanged();
  }

  const connected = conn.status === 'connected';
  return (
    <div style={box}>
      <strong>{conn.label}</strong>{' '}
      <span style={{ color: connected ? '#0a7' : '#c40' }}>
        {connected ? '● 連携済' : '○ 未連携 / 要再認可'}
      </span>
      <div style={{ fontSize: 12, color: '#666' }}>client_id: {conn.clientId}</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => onAuthorize(conn.id)}>
          freee 認可を開始(別タブ)
        </button>
        <button type="button" onClick={onChanged}>
          状態を更新
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        <strong style={{ fontSize: 13 }}>利用メンバー</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>
          {grants.map((g) => (
            <li key={g.userSub}>
              <code>{g.userSub}</code>{' '}
              <button type="button" onClick={() => void revoke(g.userSub)}>
                解除
              </button>
            </li>
          ))}
          {grants.length === 0 && <li style={{ color: '#666' }}>未割当</li>}
        </ul>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">メンバーを選択…</option>
          {members.map((m) => (
            <option key={m.userSub} value={m.userSub}>
              {m.userSub}({m.role})
            </option>
          ))}
        </select>{' '}
        <button type="button" disabled={!selected} onClick={() => selected && onGrant(conn.id, selected)}>
          割当
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// app-admin: Org 作成 + メンバー管理。Cognito user の作成自体は #12(それまでは
// console で発行した sub を貼る)。

function OrgsPanel({ me }: { me: Me }) {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [name, setName] = useState('');
  const [error, run] = useAsyncError();

  const reload = useCallback(async () => {
    const { data } = await client.models.Org.list();
    setOrgs(data);
  }, []);

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  async function createOrg() {
    await run(async () => {
      const { errors } = await client.models.Org.create({
        name,
        status: 'active',
        createdBy: me.sub,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      setName('');
      await reload();
    });
  }

  return (
    <main style={{ maxWidth: 820, margin: '1rem auto', fontFamily: 'system-ui' }}>
      <h2>組織管理(app-admin)</h2>
      {error && <p style={errStyle}>{error}</p>}
      <div style={box}>
        <input placeholder="組織名" value={name} onChange={(e) => setName(e.target.value)} />{' '}
        <button type="button" onClick={createOrg} disabled={!name}>
          組織を作成
        </button>
      </div>
      {orgs.map((o) => (
        <OrgCard key={o.id} org={o} onError={run} />
      ))}
    </main>
  );
}

function OrgCard({
  org,
  onError,
}: {
  org: OrgRow;
  onError: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [sub, setSub] = useState('');
  const [role, setRole] = useState<'org_admin' | 'user'>('org_admin');

  const reload = useCallback(async () => {
    const { data } = await client.models.Membership.listMembershipByOrgId({ orgId: org.id });
    setMembers(data);
  }, [org.id]);

  useEffect(() => {
    let alive = true;
    client.models.Membership.listMembershipByOrgId({ orgId: org.id }).then(({ data }) => {
      if (alive) setMembers(data);
    });
    return () => {
      alive = false;
    };
  }, [org.id]);

  async function add() {
    await onError(async () => {
      const { errors } = await client.mutations.addMember({ orgId: org.id, userSub: sub, role });
      throwIfErrors(errors as { message: string }[] | undefined);
      setSub('');
      await reload();
    });
  }

  async function remove(userSub: string) {
    await onError(async () => {
      const { errors } = await client.mutations.removeMember({ userSub });
      throwIfErrors(errors as { message: string }[] | undefined);
      await reload();
    });
  }

  return (
    <div style={box}>
      <strong>{org.name}</strong>{' '}
      {org.status === 'suspended' && (
        <span style={{ color: '#c40' }}>⚠ suspended(org-admin 不在)</span>
      )}
      <ul style={{ margin: '6px 0', paddingLeft: 20, fontSize: 13 }}>
        {members.map((m) => (
          <li key={m.userSub}>
            <code>{m.userSub}</code> — {m.role}{' '}
            <button type="button" onClick={() => void remove(m.userSub)}>
              削除
            </button>
          </li>
        ))}
      </ul>
      <input
        placeholder="Cognito user の sub(console 発行 → 貼付、GUI 化は #12)"
        value={sub}
        onChange={(e) => setSub(e.target.value)}
        style={{ width: 340 }}
      />{' '}
      <select value={role} onChange={(e) => setRole(e.target.value as 'org_admin' | 'user')}>
        <option value="org_admin">org_admin</option>
        <option value="user">user</option>
      </select>{' '}
      <button type="button" onClick={add} disabled={!sub}>
        メンバー追加
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Shell({ signOut }: { signOut?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<'connections' | 'orgs' | 'guide'>('connections');

  useEffect(() => {
    void loadMe().then(setMe);
  }, []);

  const tab = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    border: 'none',
    borderBottom: active ? '2px solid #0a7' : '2px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });

  if (!me) return <p style={{ fontFamily: 'system-ui', margin: '2rem' }}>読み込み中…</p>;

  return (
    <div>
      <nav
        style={{
          display: 'flex',
          gap: 8,
          borderBottom: '1px solid #eee',
          padding: '8px 16px',
          alignItems: 'center',
        }}
      >
        <button type="button" style={tab(view === 'connections')} onClick={() => setView('connections')}>
          freee 連携
        </button>
        {me.isAppAdmin && (
          <button type="button" style={tab(view === 'orgs')} onClick={() => setView('orgs')}>
            組織管理
          </button>
        )}
        <button type="button" style={tab(view === 'guide')} onClick={() => setView('guide')}>
          GPTs 設定ガイド
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#666' }}>
          {me.isAppAdmin ? 'app-admin' : (me.role ?? '未所属')}
        </span>
        <button type="button" onClick={signOut}>
          サインアウト
        </button>
      </nav>
      {view === 'connections' && <ConnectionsPanel me={me} />}
      {view === 'orgs' && me.isAppAdmin && <OrgsPanel me={me} />}
      {view === 'guide' && <GptSetupGuide />}
    </div>
  );
}

function App() {
  // hideSignUp: self sign-up is disabled (operators are admin-created).
  return <Authenticator hideSignUp>{({ signOut }) => <Shell signOut={signOut} />}</Authenticator>;
}

export default App;
