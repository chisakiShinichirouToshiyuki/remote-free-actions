import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { GptSetupGuide } from './GptSetupGuide';
import { Providers } from './providers';

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

  if (!orgId) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="info">組織に所属していません(app-admin にメンバー登録を依頼)。</Alert>
      </Container>
    );
  }

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
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" gutterBottom>
        freee アプリ接続
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            アプリを登録
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            freee アプリストアで作成したアプリの client_id / client_secret を登録します。secret は
            Secrets Manager にのみ保存されます。freee 側のコールバック URL には GPTs
            設定ガイド記載の freeeCallbackUrl を登録してください。
          </Typography>
          <Stack spacing={2} sx={{ maxWidth: 480 }}>
            <TextField
              size="small"
              label="表示名"
              placeholder="表示名(例: 会計 / 顧問先A)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <TextField
              size="small"
              label="client_id"
              placeholder="client_id"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            />
            <TextField
              size="small"
              label="client_secret"
              placeholder="client_secret"
              type="password"
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
            />
            <Button
              variant="contained"
              onClick={register}
              disabled={!form.label || !form.clientId || !form.clientSecret}
            >
              登録
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="h6" gutterBottom>
        接続一覧
      </Typography>
      {conns.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          まだ接続がありません。
        </Typography>
      )}
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
    </Container>
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
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {conn.label}
          </Typography>
          <Chip
            size="small"
            color={connected ? 'success' : 'warning'}
            label={connected ? '連携済' : '未連携 / 要再認可'}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          client_id: {conn.clientId}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button variant="contained" size="small" onClick={() => onAuthorize(conn.id)}>
            freee 認可を開始(別タブ)
          </Button>
          <Button variant="outlined" size="small" onClick={onChanged}>
            状態を更新
          </Button>
        </Stack>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          利用メンバー
        </Typography>
        <List dense>
          {grants.map((g) => (
            <ListItem
              key={g.userSub}
              secondaryAction={
                <Button size="small" color="error" onClick={() => void revoke(g.userSub)}>
                  解除
                </Button>
              }
            >
              <ListItemText slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} primary={g.userSub} />
            </ListItem>
          ))}
          {grants.length === 0 && (
            <ListItem>
              <ListItemText secondary="未割当" />
            </ListItem>
          )}
        </List>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="メンバーを選択"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            sx={{ minWidth: 360 }}
            slotProps={{ select: { native: true } }}
          >
            <option value="">メンバーを選択…</option>
            {members.map((m) => (
              <option key={m.userSub} value={m.userSub}>
                {m.userSub}({m.role})
              </option>
            ))}
          </TextField>
          <Button variant="contained" size="small" disabled={!selected} onClick={() => selected && onGrant(conn.id, selected)}>
            割当
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// app-admin: Org 作成 + メンバー管理。Cognito user の作成自体は console(GUI 化予定)。

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
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" gutterBottom>
        組織管理
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      )}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="組織名"
              placeholder="組織名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button variant="contained" onClick={createOrg} disabled={!name}>
              組織を作成
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {orgs.map((o) => (
        <OrgCard key={o.id} org={o} onError={run} />
      ))}
    </Container>
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
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {org.name}
          </Typography>
          {org.status === 'suspended' && <Chip size="small" color="error" label="suspended(org-admin 不在)" />}
        </Stack>
        <List dense>
          {members.map((m) => (
            <ListItem
              key={m.userSub}
              secondaryAction={
                <Button size="small" color="error" onClick={() => void remove(m.userSub)}>
                  削除
                </Button>
              }
            >
              <ListItemText
                slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                primary={m.userSub}
                secondary={m.role}
              />
            </ListItem>
          ))}
        </List>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label="Cognito user の sub"
            placeholder="Cognito user の sub(console 発行 → 貼付)"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            sx={{ width: 380 }}
          />
          <TextField
            select
            size="small"
            label="role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'org_admin' | 'user')}
            slotProps={{ select: { native: true } }}
            sx={{ width: 140 }}
          >
            <option value="org_admin">org_admin</option>
            <option value="user">user</option>
          </TextField>
          <Button variant="contained" onClick={add} disabled={!sub}>
            メンバー追加
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Shell({ signOut }: { signOut?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<'connections' | 'orgs' | 'guide'>('connections');

  useEffect(() => {
    void loadMe().then(setMe);
  }, []);

  if (!me) {
    return (
      <Container sx={{ py: 4 }}>
        <Typography>読み込み中…</Typography>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ mr: 3, fontSize: 16 }}>
            freee GPT bridge
          </Typography>
          <Tabs
            value={view}
            onChange={(_, v) => setView(v as typeof view)}
            textColor="inherit"
            indicatorColor="secondary"
            sx={{ flex: 1 }}
          >
            <Tab value="connections" label="freee 連携" />
            {me.isAppAdmin && <Tab value="orgs" label="組織管理" />}
            <Tab value="guide" label="GPTs 設定ガイド" />
          </Tabs>
          <Chip
            size="small"
            variant="outlined"
            color="default"
            sx={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.5)', mr: 1.5 }}
            label={me.isAppAdmin ? 'app-admin' : (me.role ?? '未所属')}
          />
          <Button color="inherit" onClick={signOut}>
            サインアウト
          </Button>
        </Toolbar>
      </AppBar>
      {view === 'connections' && <ConnectionsPanel me={me} />}
      {view === 'orgs' && me.isAppAdmin && <OrgsPanel me={me} />}
      {view === 'guide' && (
        <Container maxWidth="md" sx={{ py: 3, bgcolor: 'background.paper' }}>
          <GptSetupGuide />
        </Container>
      )}
    </Box>
  );
}

function App() {
  return <Providers>{(signOut) => <Shell signOut={signOut} />}</Providers>;
}

export default App;
