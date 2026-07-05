import { useCallback, useEffect, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
import GroupsIcon from '@mui/icons-material/Groups';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SettingsIcon from '@mui/icons-material/Settings';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import outputs from '../amplify_outputs.json';
import type { Schema } from '../amplify/data/resource';
import { GptSetupGuide } from './GptSetupGuide';
import { Providers } from './providers';
import { AppShell, type SidebarItem } from './ui/AppShell';

const client = generateClient<Schema>();

const FREEE_CALLBACK_URL =
  (outputs as { custom?: { freeeCallbackUrl?: string } }).custom?.freeeCallbackUrl ??
  'https://<freee-callback-url>';

type OrgRow = Schema['Org']['type'];
type MemberRow = Schema['Membership']['type'];
type ConnRow = {
  id: string;
  label: string;
  clientId: string;
  status: string;
  secretWrittenAt: string | null;
};

type Me = { sub: string; isAppAdmin: boolean; orgId: string | null; role: string | null };

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

function StepTitle({ done, icon, children }: { done?: boolean; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
      {icon ?? (done ? <CheckCircleIcon color="success" /> : <SettingsIcon color="primary" />)}
      <Typography variant="h6">{children}</Typography>
    </Stack>
  );
}

function CopyBox({ value }: { value: string }) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        bgcolor: 'grey.100',
        borderRadius: 1,
        pl: 1.5,
        pr: 0.5,
        py: 0.5,
        justifyContent: 'space-between',
      }}
    >
      <Typography sx={{ fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all' }}>{value}</Typography>
      <IconButton size="small" aria-label="コピー" onClick={() => void navigator.clipboard.writeText(value)}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// フリー設定(org-admin): 手順1 アプリ設定 → 手順2 認可 → 手順3 利用メンバー

function FreeeSettingsPage({ me }: { me: Me }) {
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
    setRefreshKey((k) => k + 1);
  }, [orgId]);

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  if (!orgId) return <Alert severity="info">組織に所属していません(app-admin にメンバー登録を依頼)。</Alert>;

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
    <Box sx={{ maxWidth: 1100 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <StepTitle>手順1. freee アプリ設定</StepTitle>
          <Typography variant="body1" sx={{ mb: 1 }}>
            <Link href="https://developer.freee.co.jp/" target="_blank" rel="noreferrer">
              freee Developers
            </Link>
            でアプリを作成し、発行された クライアントID / クライアントシークレット をここに入力してください。
            共通の認証情報は使わず、組織ごとに分けて保存します。
          </Typography>
          <Typography variant="body1" sx={{ mb: 1 }}>
            freee Developers アプリの「コールバック URL」欄に下記の <strong>1 件</strong>を登録してください。
          </Typography>
          <Box sx={{ mb: 2 }}>
            <CopyBox value={FREEE_CALLBACK_URL} />
          </Box>
          <Stack spacing={2}>
            <TextField
              label="表示名"
              placeholder="表示名(例: 会計 / 顧問先A)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              helperText="複数の freee アプリ(顧問先)を登録できます"
            />
            <TextField
              label="クライアントID"
              required
              placeholder="client_id"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            />
            <TextField
              label="クライアントシークレット"
              required
              type="password"
              placeholder="client_secret"
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              helperText="Secrets Manager にのみ保存されます"
            />
            <Box>
              <Button variant="outlined" onClick={register} disabled={!form.label || !form.clientId || !form.clientSecret}>
                保存
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {conns.map((c) => (
        <ConnectionSteps
          key={c.id}
          conn={c}
          refreshKey={refreshKey}
          members={members}
          onAuthorize={authorize}
          onGrant={grant}
          onChanged={() => void run(reload)}
        />
      ))}
    </Box>
  );
}

function ConnectionSteps({
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

  useEffect(() => {
    let alive = true;
    client.models.UserConnection.list({ filter: { connectionId: { eq: conn.id } } }).then(({ data }) => {
      if (alive) setGrants(data);
    });
    return () => {
      alive = false;
    };
  }, [conn.id, refreshKey]);

  async function revoke(userSub: string) {
    await client.mutations.revokeConnection({ connectionId: conn.id, userSub });
    onChanged();
  }

  const connected = conn.status === 'connected';
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <StepTitle
          done={connected}
          icon={connected ? <CheckCircleIcon color="success" /> : <RadioButtonUncheckedIcon color="warning" />}
        >
          手順2. {connected ? '認可済み' : '未認可'} — {conn.label}
        </StepTitle>
        <Typography variant="body1" sx={{ mb: 0.5 }}>
          クライアントID: <Box component="code" sx={{ fontFamily: 'monospace' }}>{conn.clientId}</Box>
        </Typography>
        {conn.secretWrittenAt && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            シークレット保存済み({new Date(conn.secretWrittenAt).toLocaleString()})
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
          <Button variant="outlined" onClick={() => onAuthorize(conn.id)}>
            {connected ? '再認証する' : '認可する'}
          </Button>
          <Button variant="outlined" color="inherit" onClick={onChanged}>
            状態を更新
          </Button>
        </Stack>

        <StepTitle icon={<GroupsIcon color={grants.length ? 'success' : 'primary'} />}>
          手順3. 利用メンバー割当
        </StepTitle>
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
              <ListItemText secondary="未割当(割当がないと GPT から利用できません)" />
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
            sx={{ minWidth: 380 }}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            <option value="">メンバーを選択…</option>
            {members.map((m) => (
              <option key={m.userSub} value={m.userSub}>
                {m.userSub}({m.role})
              </option>
            ))}
          </TextField>
          <Button variant="outlined" disabled={!selected} onClick={() => selected && onGrant(conn.id, selected)}>
            割当
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 組織管理(app-admin): 組織作成 + 初期 org-admin 任命まで。以降のユーザー管理は
// 各組織の org-admin の仕事(役割分担: app-admin は組織の器だけ作る)。

function OrgsPage({ me }: { me: Me }) {
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
      const { errors } = await client.models.Org.create({ name, status: 'active', createdBy: me.sub });
      throwIfErrors(errors as { message: string }[] | undefined);
      setName('');
      await reload();
    });
  }

  return (
    <Box sx={{ maxWidth: 1100 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      )}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <StepTitle icon={<GroupsIcon color="primary" />}>組織を作成</StepTitle>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="組織名" placeholder="組織名" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="outlined" onClick={createOrg} disabled={!name}>
              組織を作成
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {orgs.map((o) => (
        <OrgCard key={o.id} org={o} onError={run} />
      ))}
    </Box>
  );
}

function OrgCard({ org, onError }: { org: OrgRow; onError: (fn: () => Promise<void>) => Promise<void> }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [sub, setSub] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    client.models.Membership.listMembershipByOrgId({ orgId: org.id }).then(({ data }) => {
      if (alive) setMembers(data);
    });
    return () => {
      alive = false;
    };
  }, [org.id, refreshKey]);

  async function appoint() {
    await onError(async () => {
      const { errors } = await client.mutations.addMember({ orgId: org.id, userSub: sub, role: 'org_admin' });
      throwIfErrors(errors as { message: string }[] | undefined);
      setSub('');
      setRefreshKey((k) => k + 1);
    });
  }

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">{org.name}</Typography>
          {org.status === 'suspended' && (
            <Typography color="error" variant="body2">
              ⚠ suspended(org-admin 不在)
            </Typography>
          )}
        </Stack>
        <List dense>
          {members.map((m) => (
            <ListItem key={m.userSub}>
              <ListItemText
                slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                primary={m.userSub}
                secondary={m.role}
              />
            </ListItem>
          ))}
          {members.length === 0 && (
            <ListItem>
              <ListItemText secondary="org-admin 未任命(任命すると以降はその org-admin がユーザーを管理)" />
            </ListItem>
          )}
        </List>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label="初期 org-admin の sub"
            placeholder="Cognito user の sub(console 発行 → 貼付)"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            sx={{ width: 400 }}
          />
          <Button variant="outlined" onClick={appoint} disabled={!sub}>
            org-admin を任命
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ユーザー管理(org-admin): 自組織のメンバー追加・削除。最後の org-admin の
// 降格/削除は backend が拒否する。

function MembersPage({ me }: { me: Me }) {
  const orgId = me.orgId as string;
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [sub, setSub] = useState('');
  const [role, setRole] = useState<'org_admin' | 'user'>('user');
  const [error, run] = useAsyncError();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    client.models.Membership.listMembershipByOrgId({ orgId }).then(({ data }) => {
      if (alive) setMembers(data);
    });
    return () => {
      alive = false;
    };
  }, [orgId, refreshKey]);

  async function add() {
    await run(async () => {
      const { errors } = await client.mutations.addMember({ orgId, userSub: sub, role });
      throwIfErrors(errors as { message: string }[] | undefined);
      setSub('');
      setRefreshKey((k) => k + 1);
    });
  }

  async function remove(userSub: string) {
    await run(async () => {
      const { errors } = await client.mutations.removeMember({ userSub });
      throwIfErrors(errors as { message: string }[] | undefined);
      setRefreshKey((k) => k + 1);
    });
  }

  return (
    <Box sx={{ maxWidth: 1100 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <StepTitle icon={<GroupsIcon color="primary" />}>組織のユーザー管理</StepTitle>
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
              sx={{ width: 400 }}
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
              <option value="user">user</option>
              <option value="org_admin">org_admin</option>
            </TextField>
            <Button variant="outlined" onClick={add} disabled={!sub}>
              メンバー追加
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// URL 体系は logic-solver と同一: /page-id/<役割ページ>/top-menu-id/<メニュー>
//   アプリ管理者   /page-id/app-admin/top-menu-id/user-management
//   組織管理者     /page-id/organization-admin/top-menu-id/freee-settings
//   一般ユーザー   /page-id/user-app/top-menu-id/gpt-guide

const PATHS = {
  freee: '/page-id/organization-admin/top-menu-id/freee-settings',
  members: '/page-id/organization-admin/top-menu-id/user-management',
  orgs: '/page-id/app-admin/top-menu-id/org-management',
  guide: '/page-id/user-app/top-menu-id/gpt-guide',
} as const;

const PAGE_META: Record<string, { id: string; breadcrumbs: string[] }> = {
  [PATHS.freee]: { id: 'freee', breadcrumbs: ['組織管理者ページ', 'フリー設定'] },
  [PATHS.members]: { id: 'members', breadcrumbs: ['組織管理者ページ', 'ユーザー管理'] },
  [PATHS.orgs]: { id: 'orgs', breadcrumbs: ['アプリ管理者ページ', '組織管理'] },
  [PATHS.guide]: { id: 'guide', breadcrumbs: ['ユーザーページ', 'GPTs 設定ガイド'] },
};

function Shell({ signOut }: { signOut?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    void loadMe().then(setMe);
  }, []);

  if (!me) return <Typography sx={{ m: 4 }}>読み込み中…</Typography>;

  const isOrgAdmin = me.role === 'org_admin';
  const topItems: SidebarItem[] = [
    ...(me.orgId
      ? [{ id: 'freee', label: 'フリー設定', icon: <SettingsIcon fontSize="small" />, onClick: () => navigate(PATHS.freee) }]
      : []),
    ...(isOrgAdmin
      ? [{ id: 'members', label: 'ユーザー管理', icon: <GroupsIcon fontSize="small" />, onClick: () => navigate(PATHS.members) }]
      : []),
    ...(me.isAppAdmin
      ? [{ id: 'orgs', label: '組織管理', icon: <CorporateFareIcon fontSize="small" />, onClick: () => navigate(PATHS.orgs) }]
      : []),
    { id: 'guide', label: 'GPTs ガイド', icon: <MenuBookIcon fontSize="small" />, onClick: () => navigate(PATHS.guide) },
  ];
  const bottomItems: SidebarItem[] = [
    { id: 'signout', label: 'サインアウト', icon: <LogoutIcon fontSize="small" />, onClick: () => signOut?.() },
  ];

  const meta = PAGE_META[location.pathname] ?? PAGE_META[PATHS.freee];
  // 役割ごとの着地: app-admin → 組織管理 / org 所属 → フリー設定 / それ以外 → ガイド
  const home = me.isAppAdmin ? PATHS.orgs : me.orgId ? PATHS.freee : PATHS.guide;

  return (
    <AppShell
      topItems={topItems}
      bottomItems={bottomItems}
      activeItemId={(meta as { id: string }).id}
      breadcrumbs={(meta as { breadcrumbs: string[] }).breadcrumbs}
    >
      <Routes>
        <Route path={PATHS.freee} element={<FreeeSettingsPage me={me} />} />
        <Route
          path={PATHS.members}
          element={isOrgAdmin ? <MembersPage me={me} /> : <Navigate to={home} replace />}
        />
        <Route
          path={PATHS.orgs}
          element={me.isAppAdmin ? <OrgsPage me={me} /> : <Navigate to={home} replace />}
        />
        <Route path={PATHS.guide} element={<GptSetupGuide />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AppShell>
  );
}

function App() {
  return <Providers>{(signOut) => <Shell signOut={signOut} />}</Providers>;
}

export default App;
