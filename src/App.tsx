import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AddIcon from '@mui/icons-material/Add';
import ApartmentIcon from '@mui/icons-material/Apartment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupsIcon from '@mui/icons-material/Groups';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import outputs from '../amplify_outputs.json';
import type { Schema } from '../amplify/data/resource';
import { GptSetupGuide } from './GptSetupGuide';
import { Providers } from './providers';
import { AppShell, type BreadcrumbItem, type SidebarItem } from './ui/AppShell';

const client = generateClient<Schema>();

// ページが AppShell ヘッダ右のアクション領域(データ更新 / 追加ボタン等)へ
// ボタンを差し込むための口。logic-solver の per-page AdminAppShell の actions と
// 同じ配置(breadcrumb と同一行の右)を、単一 AppShell 構成で再現する。
const HeaderActionsContext = createContext<(node: ReactNode) => void>(() => {});

// ページが breadcrumb を延長するための口(例: フリー設定 > アプリ名 / 新規作成)。
// PAGE_META の base breadcrumb に page 側の追加 segment を足す。
const BreadcrumbExtraContext = createContext<(items: BreadcrumbItem[]) => void>(() => {});

const FREEE_CALLBACK_URL =
  (outputs as { custom?: { freeeCallbackUrl?: string } }).custom?.freeeCallbackUrl ?? 'https://<freee-callback-url>';

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
type OrgMember = {
  userSub: string;
  email: string;
  role: string | null;
  status: string;
};

async function fetchOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data, errors } = await client.queries.listOrgMembers({ orgId });
  throwIfErrors(errors as { message: string }[] | undefined);
  return (typeof data === 'string' ? JSON.parse(data) : data) as OrgMember[];
}

async function loadMe(): Promise<Me> {
  const session = await fetchAuthSession();
  const sub = session.tokens?.accessToken.payload.sub as string;
  const groups = (session.tokens?.accessToken.payload['cognito:groups'] ?? []) as string[];
  const { data: membership } = await client.models.Membership.get({
    userSub: sub,
  });
  return {
    sub,
    isAppAdmin: groups.includes('app-admin'),
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
  };
}

function throwIfErrors(errors: { message: string }[] | undefined | null) {
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('\n'));
}

// 破壊的操作の確認モーダル。`await confirm(msg)` が true/false を返し、`dialog` を
// レンダリングツリーに置く。誤操作(= 直近の org-admin 誤削除)の再発防止。
function useConfirm() {
  const [pending, setPending] = useState<string | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPending(message);
      }),
    [],
  );
  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setPending(null);
  }, []);
  const dialog = (
    <Dialog open={pending !== null} onClose={() => close(false)} maxWidth="xs" fullWidth>
      <DialogTitle>確認</DialogTitle>
      <DialogContent>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{pending}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => close(false)}>キャンセル</Button>
        <Button color="error" variant="contained" onClick={() => close(true)}>
          実行する
        </Button>
      </DialogActions>
    </Dialog>
  );
  return { confirm, dialog };
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

// フリー設定(org-admin): アプリ一覧(表)→ 行 or 新規作成で詳細(手順1/2)。
// 利用メンバー割当は「ユーザー管理」の アプリ列 に移設(ここには無い)。
function FreeeSettingsPage({ me }: { me: Me }) {
  const orgId = me.orgId;
  const setHeaderActions = useContext(HeaderActionsContext);
  const setBreadcrumbExtra = useContext(BreadcrumbExtraContext);
  const [conns, setConns] = useState<ConnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'new' | { id: string }>('list');
  const [snack, setSnack] = useState<{
    open: boolean;
    message: string;
    severity: SnackSeverity;
  }>({
    open: false,
    message: '',
    severity: 'info',
  });
  const notify = useCallback(
    (message: string, severity: SnackSeverity) => setSnack({ open: true, message, severity }),
    [],
  );
  const { confirm, dialog: confirmDialog } = useConfirm();

  const reload = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, errors } = await client.queries.listOrgConnections({
        orgId,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      setConns((typeof data === 'string' ? JSON.parse(data) : data) as ConnRow[]);
    } catch (err) {
      notify(`読込失敗: ${errMessage(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, notify]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (view === 'list') {
      setBreadcrumbExtra(['アプリ一覧']);
      setHeaderActions(
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            color="primary"
            startIcon={<RefreshIcon />}
            onClick={() => void reload()}
            disabled={loading}
          >
            データ更新
          </Button>
          <Button variant="outlined" color="primary" startIcon={<AddIcon />} onClick={() => setView('new')}>
            アプリ追加
          </Button>
        </Stack>,
      );
    } else {
      // breadcrumb の「アプリ一覧」リンクで一覧に戻れるので、戻るボタンは置かない。
      const label = view === 'new' ? 'アプリ追加' : (conns.find((c) => c.id === view.id)?.label ?? 'アプリ');
      setBreadcrumbExtra([{ label: 'アプリ一覧', onClick: () => setView('list') }, label]);
      setHeaderActions(null);
    }
    return () => {
      setBreadcrumbExtra([]);
      setHeaderActions(null);
    };
  }, [view, conns, loading, reload, setBreadcrumbExtra, setHeaderActions]);

  async function deleteApp(conn: ConnRow) {
    if (!(await confirm(`freee アプリ「${conn.label}」を削除しますか?\n利用メンバーの割当と保存済みシークレットも削除されます。`))) return;
    try {
      const { errors } = await client.mutations.deleteFreeeApp({ connectionId: conn.id });
      throwIfErrors(errors as { message: string }[] | undefined);
      notify('アプリを削除しました', 'success');
      await reload();
    } catch (err) {
      notify(`削除失敗: ${errMessage(err)}`, 'error');
    }
  }

  if (!orgId) {
    return <Alert severity="info">組織に所属していません(app-admin にメンバー登録を依頼)。</Alert>;
  }

  if (view === 'new') {
    return (
      <FreeeAppDetail
        orgId={orgId}
        conn={null}
        onDone={(message) => {
          notify(message, 'success');
          setView('list');
          void reload();
        }}
        onError={(message) => notify(message, 'error')}
      />
    );
  }
  if (view !== 'list') {
    const c = conns.find((x) => x.id === view.id);
    if (!c) return <Alert severity="warning">接続が見つかりません。</Alert>;
    return (
      <FreeeAppDetail
        orgId={orgId}
        conn={c}
        onDone={(message) => {
          notify(message, 'success');
          void reload();
        }}
        onError={(message) => notify(message, 'error')}
      />
    );
  }

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          '& th, & td': {
            borderRight: '1px solid',
            borderRightColor: 'divider',
          },
          '& th:last-of-type, & td:last-of-type': { borderRight: 'none' },
          '& thead th': {
            bgcolor: '#e8eaf6',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          },
          '& tbody tr:nth-of-type(even)': { bgcolor: 'grey.50' },
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="center">表示名</TableCell>
              <TableCell align="center">クライアントID</TableCell>
              <TableCell align="center">状態</TableCell>
              <TableCell align="center">シークレット</TableCell>
              <TableCell align="center">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            ) : conns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  freee アプリがまだありません。「アプリ追加」から登録してください。
                </TableCell>
              </TableRow>
            ) : (
              conns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell align="center">{c.label}</TableCell>
                  <TableCell align="center">
                    <Typography component="code" variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {c.clientId}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={c.status === 'connected' ? '認可済み' : '未認可'}
                      color={c.status === 'connected' ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                    {c.secretWrittenAt ? formatJpDateTime(c.secretWrittenAt) : '未保存'}
                  </TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton size="small" color="primary" onClick={() => setView({ id: c.id })} title="設定">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => void deleteApp(c)} title="削除">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {confirmDialog}
      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Box
          sx={{
            bgcolor:
              snack.severity === 'error' ? 'error.main' : snack.severity === 'success' ? 'success.main' : 'info.main',
            color: '#fff',
            px: 2,
            py: 1.5,
            borderRadius: 1,
          }}
        >
          {snack.message}
        </Box>
      </Snackbar>
    </Box>
  );
}

// 新規作成(conn=null): 手順1 登録フォーム。既存(conn): 手順1 情報 + 手順2 認可。
function FreeeAppDetail({
  orgId,
  conn,
  onDone,
  onError,
}: {
  orgId: string;
  conn: ConnRow | null;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    label: '',
    clientId: '',
    clientSecret: '',
  });
  const [busy, setBusy] = useState(false);

  async function register() {
    setBusy(true);
    try {
      const { errors } = await client.mutations.registerFreeeApp({
        orgId,
        ...form,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      onDone(`freee アプリ「${form.label}」を登録しました`);
    } catch (err) {
      onError(`登録失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function authorize() {
    if (!conn) return;
    setBusy(true);
    try {
      const { data, errors } = await client.mutations.startFreeeAuthorize({
        connectionId: conn.id,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      if (data) window.open(data, '_blank', 'noopener');
    } catch (err) {
      onError(`認可開始失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // 進捗アイコン(既存アプリと新規で統一): 完了=緑チェック / 未完=グレー未チェック。
  const step1Done = conn ? true : Boolean(form.label && form.clientId && form.clientSecret);
  const connected = conn?.status === 'connected';
  const step1Icon = step1Done ? <CheckCircleIcon color="success" /> : <RadioButtonUncheckedIcon color="disabled" />;
  const step2Icon = connected ? (
    <CheckCircleIcon color="success" />
  ) : (
    <RadioButtonUncheckedIcon color={conn ? 'warning' : 'disabled'} />
  );

  return (
    <Box>
      <Stack spacing={3}>
        <Card variant="outlined">
          <CardContent>
            <StepTitle done={step1Done} icon={step1Icon}>
              手順1. freee アプリ設定
            </StepTitle>
            {conn ? (
              <>
                <Typography variant="body1">表示名: {conn.label}</Typography>
                <Typography variant="body1" sx={{ mb: 0.5 }}>
                  クライアントID:{' '}
                  <Box component="code" sx={{ fontFamily: 'monospace' }}>
                    {conn.clientId}
                  </Box>
                </Typography>
                {conn.secretWrittenAt && (
                  <Typography variant="body2" color="text.secondary">
                    シークレット保存済み(
                    {formatJpDateTime(conn.secretWrittenAt)})
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <Link href="https://developer.freee.co.jp/" target="_blank" rel="noreferrer">
                    freee Developers
                  </Link>
                  でアプリを作成し、発行された クライアントID / クライアントシークレット
                  をここに入力してください。共通の認証情報は使わず、組織ごとに分けて保存します。
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
                    helperText="保存後は表示されません"
                  />
                  <Box>
                    <Button variant="contained" onClick={() => void register()} disabled={busy || !step1Done}>
                      保存
                    </Button>
                  </Box>
                </Stack>
              </>
            )}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <StepTitle done={connected} icon={step2Icon}>
              手順2. {conn ? (connected ? '認可済み' : '未認可') : '認可'}
            </StepTitle>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              freee にログインしてこのアプリにアクセスを許可します。利用メンバーの割当は「ユーザー管理」で行います。
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => void authorize()} disabled={busy || !conn}>
                {connected ? '再認証する' : '認可する'}
              </Button>
              {conn && (
                <Button variant="outlined" onClick={() => onDone('状態を更新しました')} disabled={busy}>
                  状態を更新
                </Button>
              )}
            </Stack>
            {!conn && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                手順1 を保存すると認可できます。
              </Typography>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 組織管理(app-admin): 組織一覧をテーブルで表示(logic-solver の組織管理と同一流儀)。
// 「組織を追加」で組織作成 + 初期 org-admin 任命、行クリックで org-admin 管理。
// メンバー(一般ユーザー)の日常管理は org-admin が「ユーザー管理」で行う。

type UsageStatus = '未開始' | '管理者ログイン済み' | 'freee設定済み';

interface OrgTableRow {
  id: string;
  name: string;
  status: string | null;
  adminEmail: string;
  userCount: number;
  usageStatus: UsageStatus;
  createdAt: string;
  updatedAt: string;
}

function formatJpDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hh}時${mm}分`;
}

function usageChipColor(s: UsageStatus): 'default' | 'info' | 'success' {
  if (s === '未開始') return 'default';
  if (s === '管理者ログイン済み') return 'info';
  return 'success';
}

type SnackSeverity = 'success' | 'error' | 'info';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

function OrgsPage({ me }: { me: Me }) {
  const setHeaderActions = useContext(HeaderActionsContext);
  const [rows, setRows] = useState<OrgTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<OrgTableRow | null>(null);
  const [snack, setSnack] = useState<{
    open: boolean;
    message: string;
    severity: SnackSeverity;
  }>({
    open: false,
    message: '',
    severity: 'info',
  });
  const notify = useCallback(
    (message: string, severity: SnackSeverity) => setSnack({ open: true, message, severity }),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgsResp, connsResp] = await Promise.all([client.models.Org.list(), client.models.FreeeConnection.list()]);
      const orgs = orgsResp.data ?? [];
      const conns = connsResp.data ?? [];
      const result = await Promise.all(
        orgs.map(async (o): Promise<OrgTableRow> => {
          const members = await fetchOrgMembers(o.id).catch(() => [] as OrgMember[]);
          const admin = members.find((m) => m.role === 'org_admin');
          const conn = conns.find((c) => c.orgId === o.id);
          // 未開始 = freee接続なし / 管理者ログイン済み = 接続はあるが secret 未保存 /
          // freee設定済み = client_secret 保存済み(= 認可の前提が整っている)。
          const usageStatus: UsageStatus = !conn
            ? '未開始'
            : conn.secretWrittenAt
              ? 'freee設定済み'
              : '管理者ログイン済み';
          return {
            id: o.id,
            name: o.name,
            status: o.status,
            adminEmail: admin?.email ?? '(未設定)',
            userCount: members.length,
            usageStatus,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
          };
        }),
      );
      setRows(result);
    } catch (err) {
      notify(`読込失敗: ${errMessage(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // ヘッダ右のアクション(データ更新 / 組織を追加)。logic-solver の
  // AdminAppShell actions と同一配置(breadcrumb と同じ行)。
  useEffect(() => {
    // Stack で 1 つの flex child にまとめる。素の Fragment だと 2 ボタンが header
    // flex(space-between)の別々の子になって左右に散る。
    setHeaderActions(
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
        >
          データ更新
        </Button>
        <Button variant="outlined" color="primary" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          組織を追加
        </Button>
      </Stack>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, load, loading]);

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          // 全 cell に縦罫線(最終列は除く) — logic-solver と同一の縦区切り table。
          '& th, & td': {
            borderRight: '1px solid',
            borderRightColor: 'divider',
          },
          '& th:last-of-type, & td:last-of-type': { borderRight: 'none' },
          // header は薄青、偶数行のみ zebra(hover の action.hover を活かす)。
          '& thead th': {
            bgcolor: '#e8eaf6',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          },
          '& tbody tr:nth-of-type(even)': { bgcolor: 'grey.50' },
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="center">組織ID</TableCell>
              <TableCell align="center">組織名</TableCell>
              <TableCell align="center">管理者</TableCell>
              <TableCell align="center">ユーザー数</TableCell>
              <TableCell align="center">使用状況</TableCell>
              <TableCell align="center">作成日時</TableCell>
              <TableCell align="center">更新日時</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  組織がまだありません。「組織を追加」から作成してください。
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  hover
                  onClick={() => setEditing(r)}
                  title="クリックして編集"
                  sx={{
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <TableCell align="center">
                    <Typography component="code" variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {r.id}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {r.name}
                    {r.status === 'suspended' && (
                      <Typography component="span" color="error" variant="caption" sx={{ ml: 0.5 }}>
                        (停止中)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">{r.adminEmail}</TableCell>
                  <TableCell align="right">{r.userCount}</TableCell>
                  <TableCell align="center">
                    <Chip size="small" label={r.usageStatus} color={usageChipColor(r.usageStatus)} />
                  </TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                    {formatJpDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                    {formatJpDateTime(r.updatedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <AddOrgDialog
        open={addOpen}
        me={me}
        onClose={() => setAddOpen(false)}
        onDone={(message) => {
          setAddOpen(false);
          notify(message, 'success');
          void load();
        }}
        onError={(message) => notify(message, 'error')}
      />
      <EditOrgDialog
        org={editing}
        onClose={() => setEditing(null)}
        onChanged={(message) => {
          notify(message, 'success');
          void load();
        }}
        onDeleted={() => {
          setEditing(null);
          notify('組織を削除しました', 'success');
          void load();
        }}
        onError={(message) => notify(message, 'error')}
      />
      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Box
          sx={{
            bgcolor:
              snack.severity === 'error' ? 'error.main' : snack.severity === 'success' ? 'success.main' : 'info.main',
            color: '#fff',
            px: 2,
            py: 1.5,
            borderRadius: 1,
          }}
        >
          {snack.message}
        </Box>
      </Snackbar>
    </Box>
  );
}

// 組織を追加 = 組織作成 + 初期 org-admin の email 任命(logic-solver の新規組織
// dialog と同一構成)。rfa は provisionOrganization mutation を持たないので
// Org.create + createOrgUser の 2 手で組む。
function AddOrgDialog({
  open,
  me,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  me: Me;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
    }
  }, [open]);

  async function handleAdd() {
    setSubmitting(true);
    try {
      const { data: org, errors } = await client.models.Org.create({
        name: name.trim(),
        status: 'active',
        createdBy: me.sub,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      if (org) {
        const { errors: e2 } = await client.mutations.createOrgUser({
          orgId: org.id,
          email: email.trim(),
          role: 'org_admin',
        });
        throwIfErrors(e2 as { message: string }[] | undefined);
      }
      onDone(`組織を作成しました(${email.trim()} に招待メール送信済)`);
    } catch (err) {
      onError(`作成失敗: ${errMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          elevation: 0,
          sx: { border: '1px solid', borderColor: 'divider' },
        },
      }}
    >
      <DialogTitle>新規組織を作成</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="組織名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="初期管理者の email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            helperText="この email の Cognito user を org-admin に任命します。未登録なら招待メールが届きます。"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          キャンセル
        </Button>
        <Button onClick={handleAdd} variant="contained" disabled={submitting || !name.trim() || !isValidEmail(email)}>
          {submitting ? <CircularProgress size={20} /> : '作成'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// 行クリック = 組織を編集。組織名の更新 + 管理者変更フォーム(任命 / 解除)+ 組織削除。
// logic-solver は表示用 email を Membership.update するが、rfa は Membership に email を
// 持たない(Cognito が正本)ため、管理者変更は createOrgUser / removeMember で行う。
function EditOrgDialog({
  org,
  onClose,
  onChanged,
  onDeleted,
  onError,
}: {
  org: OrgTableRow | null;
  onClose: () => void;
  onChanged: (message: string) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [name, setName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const orgId = org?.id ?? null;
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (org) {
      setName(org.name);
      setNewAdminEmail('');
      setConfirmDelete(false);
    }
  }, [org]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetchOrgMembers(orgId).then((rows) => {
      if (alive) setMembers(rows);
    });
    return () => {
      alive = false;
    };
  }, [orgId, refreshKey]);

  const admins = members.filter((m) => m.role === 'org_admin');
  // 最後の 1 人は解除させない(backend removeMember も弾くが、UI で先に止めて
  // エラーを踏ませない)。削除済みは active に数えない。
  const activeAdminCount = admins.filter((m) => m.status !== 'deleted').length;

  async function saveName() {
    if (!org || !name.trim() || name.trim() === org.name) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const { errors } = await client.models.Org.update({
        id: org.id,
        name: name.trim(),
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      onChanged('保存しました');
      onClose();
    } catch (err) {
      onError(`保存失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function appointAdmin() {
    if (!orgId || !newAdminEmail.trim()) return;
    setBusy(true);
    try {
      const { errors } = await client.mutations.createOrgUser({
        orgId,
        email: newAdminEmail.trim(),
        role: 'org_admin',
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      setNewAdminEmail('');
      setRefreshKey((k) => k + 1);
      onChanged('管理者を追加しました');
    } catch (err) {
      onError(`任命失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(member: OrgMember) {
    if (!(await confirm(`「${member.email}」を組織管理者から解除しますか?`))) return;
    setBusy(true);
    try {
      const { errors } = await client.mutations.removeMember({
        userSub: member.userSub,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      setRefreshKey((k) => k + 1);
      onChanged('管理者を解除しました');
    } catch (err) {
      onError(`解除失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrg() {
    if (!org) return;
    setBusy(true);
    try {
      // 紐づく freee 接続を先に削除(app-admin が書込可)→ Org 削除。
      const { data: conns } = await client.models.FreeeConnection.list({
        filter: { orgId: { eq: org.id } },
      });
      await Promise.all((conns ?? []).map((c) => client.models.FreeeConnection.delete({ id: c.id })));
      const { errors } = await client.models.Org.delete({ id: org.id });
      throwIfErrors(errors as { message: string }[] | undefined);
      onDeleted();
    } catch (err) {
      onError(`削除失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={org !== null}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          elevation: 0,
          sx: { border: '1px solid', borderColor: 'divider' },
        },
      }}
    >
      <DialogTitle>組織を編集</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="組織ID" value={org?.id ?? ''} fullWidth disabled />
          <TextField
            label="組織名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              組織管理者
            </Typography>
          </Divider>
          <List dense sx={{ py: 0 }}>
            {admins.map((m) => (
              <ListItem
                key={m.userSub}
                secondaryAction={
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    onClick={() => void removeAdmin(m)}
                    disabled={busy || activeAdminCount <= 1}
                    title={activeAdminCount <= 1 ? '最後の組織管理者は解除できません' : undefined}
                    sx={{ flexShrink: 0 }}
                  >
                    解除
                  </Button>
                }
              >
                <ListItemText primary={m.email} secondary="org-admin" />
              </ListItem>
            ))}
            {admins.length === 0 && (
              <ListItem>
                <ListItemText secondary="org-admin 未任命(下で任命してください)" />
              </ListItem>
            )}
          </List>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              type="email"
              label="管理者を追加(email)"
              placeholder="org-admin@example.com"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              fullWidth
            />
            <Button
              variant="contained"
              startIcon={<PersonAddIcon />}
              onClick={() => void appointAdmin()}
              disabled={busy || !isValidEmail(newAdminEmail)}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              任命
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Button
          variant="contained"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
        >
          組織を削除
        </Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} disabled={busy}>
            閉じる
          </Button>
          <Button variant="contained" onClick={() => void saveName()} disabled={busy || !name.trim()}>
            保存
          </Button>
        </Stack>
      </DialogActions>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>組織を削除しますか?</DialogTitle>
        <DialogContent>
          <Typography>「{org?.name}」と紐づく freee 接続を削除します。この操作は取り消せません。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={busy}>
            キャンセル
          </Button>
          <Button color="error" variant="contained" onClick={() => void deleteOrg()} disabled={busy}>
            削除する
          </Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ユーザー管理(org-admin): 自組織のメンバーを email で追加/一覧/削除。
// createOrgUser が招待メール送信 → Membership 作成を 1 操作で行う。

// ユーザー管理(org-admin): ユーザー一覧表(email 左寄せ / ロール日本語 / 割り当てアプリ /
// 操作は編集・削除アイコン)。追加は header 右、編集は edit アイコン→モーダル。
// 旧「フリー設定 手順3」の利用メンバー割当はここ(編集モーダル)へ移設。
function roleLabel(role: string | null): string {
  return role === 'org_admin' ? '組織管理者' : '一般ユーザー';
}

function MembersPage({ me }: { me: Me }) {
  const orgId = me.orgId;
  const setHeaderActions = useContext(HeaderActionsContext);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [conns, setConns] = useState<ConnRow[]>([]);
  const [grants, setGrants] = useState<Schema['UserConnection']['type'][]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<OrgMember | null>(null);
  const [snack, setSnack] = useState<{
    open: boolean;
    message: string;
    severity: SnackSeverity;
  }>({
    open: false,
    message: '',
    severity: 'info',
  });
  const notify = useCallback(
    (message: string, severity: SnackSeverity) => setSnack({ open: true, message, severity }),
    [],
  );
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [mem, connResp] = await Promise.all([fetchOrgMembers(orgId), client.queries.listOrgConnections({ orgId })]);
      throwIfErrors(connResp.errors as { message: string }[] | undefined);
      const connList = (typeof connResp.data === 'string' ? JSON.parse(connResp.data) : connResp.data) as ConnRow[];
      const grantLists = await Promise.all(
        connList.map((c) =>
          client.models.UserConnection.list({
            filter: { connectionId: { eq: c.id } },
          }),
        ),
      );
      setMembers(mem);
      setConns(connList);
      setGrants(grantLists.flatMap((g) => g.data));
    } catch (err) {
      notify(`読込失敗: ${errMessage(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHeaderActions(
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
        >
          データ更新
        </Button>
        <Button variant="outlined" color="primary" startIcon={<PersonAddIcon />} onClick={() => setAddOpen(true)}>
          ユーザーを追加
        </Button>
      </Stack>,
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, load, loading]);

  if (!orgId) {
    return <Alert severity="info">組織に所属していません(app-admin に org-admin 任命を依頼してください)。</Alert>;
  }

  async function removeUser(member: OrgMember) {
    if (!(await confirm(`ユーザー「${member.email}」を削除しますか?\n組織から除外され、アプリ割当も解除されます。`)))
      return;
    try {
      const { errors } = await client.mutations.removeMember({
        userSub: member.userSub,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      notify('メンバーを削除しました', 'success');
      await load();
    } catch (err) {
      notify(`削除失敗: ${errMessage(err)}`, 'error');
    }
  }

  return (
    <Box>
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          '& th, & td': {
            borderRight: '1px solid',
            borderRightColor: 'divider',
          },
          '& th:last-of-type, & td:last-of-type': { borderRight: 'none' },
          '& thead th': {
            bgcolor: '#e8eaf6',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          },
          '& tbody tr:nth-of-type(even)': { bgcolor: 'grey.50' },
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>メールアドレス</TableCell>
              <TableCell align="center">ロール</TableCell>
              <TableCell align="center">割り当てアプリ</TableCell>
              <TableCell align="center">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  メンバーがいません。「ユーザーを追加」から追加してください。
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => {
                const grantedIds = grants
                  .filter((g) => g.userSub === m.userSub && g.status !== 'inactive')
                  .map((g) => g.connectionId);
                return (
                  <TableRow key={m.userSub}>
                    <TableCell>{m.email}</TableCell>
                    <TableCell align="center">{m.status === 'deleted' ? '削除済み' : roleLabel(m.role)}</TableCell>
                    <TableCell align="center">
                      <MemberAppsCell conns={conns} granted={grantedIds} />
                    </TableCell>
                    <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="small" color="primary" onClick={() => setEditing(m)} title="編集">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => void removeUser(m)} title="削除">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <AddMemberDialog
        open={addOpen}
        orgId={orgId}
        onClose={() => setAddOpen(false)}
        onDone={(message) => {
          setAddOpen(false);
          notify(message, 'success');
          void load();
        }}
        onError={(message) => notify(message, 'error')}
      />
      <UserEditDialog
        member={editing}
        conns={conns}
        onClose={() => setEditing(null)}
        onChanged={(message) => {
          notify(message, 'success');
          void load();
        }}
        onError={(message) => notify(message, 'error')}
      />
      {confirmDialog}
      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Box
          sx={{
            bgcolor:
              snack.severity === 'error' ? 'error.main' : snack.severity === 'success' ? 'success.main' : 'info.main',
            color: '#fff',
            px: 2,
            py: 1.5,
            borderRadius: 1,
          }}
        >
          {snack.message}
        </Box>
      </Snackbar>
    </Box>
  );
}

// 割り当てアプリ列(表示専用): 1 個目を Chip、2 個目以降は「他N件」+ ホバーで全件。
function MemberAppsCell({ conns, granted }: { conns: ConnRow[]; granted: string[] }) {
  const labelOf = (id: string) => conns.find((c) => c.id === id)?.label ?? id;
  if (granted.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        未割当
      </Typography>
    );
  }
  const first = granted[0] as string;
  const restCount = granted.length - 1;
  return (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center', alignItems: 'center' }}>
      <Chip size="small" color="primary" variant="outlined" label={labelOf(first)} />
      {restCount > 0 && (
        <Tooltip title={granted.map(labelOf).join(', ')}>
          <Chip size="small" variant="outlined" label={`他${restCount}件`} />
        </Tooltip>
      )}
    </Stack>
  );
}

function AddMemberDialog({
  open,
  orgId,
  onClose,
  onDone,
  onError,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'org_admin' | 'user'>('user');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('user');
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      const { errors } = await client.mutations.createOrgUser({
        orgId,
        email: email.trim(),
        role,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      onDone(`${email.trim()} を追加しました`);
    } catch (err) {
      onError(`追加失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          elevation: 0,
          sx: { border: '1px solid', borderColor: 'divider' },
        },
      }}
    >
      <DialogTitle>ユーザーを追加</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="メールアドレス"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            autoFocus
            helperText="未登録なら招待メールが届きます"
          />
          <TextField
            select
            label="ロール"
            value={role}
            onChange={(e) => setRole(e.target.value as 'org_admin' | 'user')}
            fullWidth
            slotProps={{ select: { native: true } }}
          >
            <option value="user">一般ユーザー</option>
            <option value="org_admin">組織管理者</option>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          キャンセル
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !isValidEmail(email)}>
          追加
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// edit アイコン→ユーザー編集: ロール変更 + 割り当てアプリ(0-N の付与/解除)。
function UserEditDialog({
  member,
  conns,
  onClose,
  onChanged,
  onError,
}: {
  member: OrgMember | null;
  conns: ConnRow[];
  onClose: () => void;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState<'org_admin' | 'user'>('user');
  const [grantedIds, setGrantedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const userSub = member?.userSub ?? null;
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (member) setRole(member.role === 'org_admin' ? 'org_admin' : 'user');
  }, [member]);

  const reloadGrants = useCallback(async () => {
    if (!userSub) return;
    const { data } = await client.models.UserConnection.listUserConnectionByUserSub({
      userSub,
    });
    setGrantedIds(data.filter((g) => g.status !== 'inactive').map((g) => g.connectionId));
  }, [userSub]);
  useEffect(() => {
    void reloadGrants();
  }, [reloadGrants]);

  async function saveRole() {
    if (!member) return;
    setBusy(true);
    try {
      if (role !== member.role) {
        const { errors } = await client.mutations.setMemberRole({
          userSub: member.userSub,
          role,
        });
        throwIfErrors(errors as { message: string }[] | undefined);
      }
      onChanged('保存しました');
      onClose();
    } catch (err) {
      onError(`保存失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }
  async function grantApp(connectionId: string) {
    if (!userSub) return;
    setBusy(true);
    try {
      const { errors } = await client.mutations.grantConnection({
        userSub,
        connectionId,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      await reloadGrants();
      onChanged('アプリを割り当てました');
    } catch (err) {
      onError(`割当失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }
  async function revokeApp(connectionId: string) {
    if (!userSub) return;
    if (!(await confirm(`アプリ「${labelOf(connectionId)}」の割当を解除しますか?`))) return;
    setBusy(true);
    try {
      const { errors } = await client.mutations.revokeConnection({
        userSub,
        connectionId,
      });
      throwIfErrors(errors as { message: string }[] | undefined);
      await reloadGrants();
      onChanged('アプリを解除しました');
    } catch (err) {
      onError(`解除失敗: ${errMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const labelOf = (id: string) => conns.find((c) => c.id === id)?.label ?? id;
  const available = conns.filter((c) => !grantedIds.includes(c.id));

  return (
    <>
      <Dialog
        open={member !== null}
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: {
            elevation: 0,
            sx: { border: '1px solid', borderColor: 'divider' },
          },
        }}
      >
        <DialogTitle>ユーザーを編集</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="メールアドレス" value={member?.email ?? ''} fullWidth disabled />
            <TextField
              select
              label="ロール"
              value={role}
              onChange={(e) => setRole(e.target.value as 'org_admin' | 'user')}
              fullWidth
              slotProps={{ select: { native: true } }}
            >
              <option value="user">一般ユーザー</option>
              <option value="org_admin">組織管理者</option>
            </TextField>
            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                割り当てアプリ
              </Typography>
            </Divider>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              {grantedIds.map((id) => (
                <Chip
                  key={id}
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={labelOf(id)}
                  onDelete={() => void revokeApp(id)}
                  disabled={busy}
                />
              ))}
              {grantedIds.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  未割当
                </Typography>
              )}
              {available.length > 0 && (
                <TextField
                  select
                  size="small"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) void grantApp(e.target.value);
                  }}
                  slotProps={{
                    select: { native: true },
                    inputLabel: { shrink: true },
                  }}
                  sx={{ minWidth: 150 }}
                  disabled={busy}
                >
                  <option value="">+ アプリ追加</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </TextField>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            閉じる
          </Button>
          <Button variant="contained" onClick={() => void saveRole()} disabled={busy}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// URL 体系は logic-solver と同一: /page-id/<役割ページ>/top-menu-id/<メニュー>
//   アプリ管理者   /page-id/app-admin/top-menu-id/org-management   … 組織管理のみ
//   組織管理者     /page-id/organization-admin/top-menu-id/freee-settings
//   組織管理者     /page-id/organization-admin/top-menu-id/user-management … ユーザー管理
//   一般ユーザー   /page-id/user-app/top-menu-id/gpt-guide

const PATHS = {
  orgs: '/page-id/app-admin/top-menu-id/org-management',
  freee: '/page-id/organization-admin/top-menu-id/freee-settings',
  users: '/page-id/organization-admin/top-menu-id/user-management',
  guide: '/page-id/user-app/top-menu-id/gpt-guide',
} as const;

const PAGE_META: Record<string, { id: string; breadcrumbs: string[] }> = {
  [PATHS.orgs]: { id: 'orgs', breadcrumbs: ['アプリ管理者ページ', '組織管理'] },
  [PATHS.freee]: { id: 'freee', breadcrumbs: ['組織管理者ページ'] },
  [PATHS.users]: {
    id: 'users',
    breadcrumbs: ['組織管理者ページ', 'ユーザーの一覧'],
  },
  [PATHS.guide]: {
    id: 'guide',
    breadcrumbs: ['ユーザーページ', 'GPTs 設定ガイド'],
  },
};

function Shell({ signOut }: { signOut?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [breadcrumbExtra, setBreadcrumbExtra] = useState<BreadcrumbItem[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    void loadMe().then(setMe);
  }, []);

  if (!me) return <Typography sx={{ m: 4 }}>読み込み中…</Typography>;

  const isOrgAdmin = me.role === 'org_admin' && !!me.orgId;
  const topItems: SidebarItem[] = [
    ...(me.isAppAdmin
      ? [
          {
            id: 'orgs',
            label: '組織管理',
            icon: <ApartmentIcon fontSize="small" />,
            onClick: () => navigate(PATHS.orgs),
          },
        ]
      : []),
    ...(isOrgAdmin
      ? [
          {
            id: 'freee',
            label: 'フリー設定',
            icon: <SettingsIcon fontSize="small" />,
            onClick: () => navigate(PATHS.freee),
          },
          {
            id: 'users',
            label: 'ユーザー管理',
            icon: <GroupsIcon fontSize="small" />,
            onClick: () => navigate(PATHS.users),
          },
        ]
      : []),
    {
      id: 'guide',
      label: 'GPTs ガイド',
      icon: <MenuBookIcon fontSize="small" />,
      onClick: () => navigate(PATHS.guide),
    },
  ];
  const bottomItems: SidebarItem[] = [
    {
      id: 'signout',
      label: 'サインアウト',
      icon: <LogoutIcon fontSize="small" />,
      onClick: () => signOut?.(),
    },
  ];

  const meta = PAGE_META[location.pathname] ?? PAGE_META[PATHS.guide];
  // 役割ごとの着地: app-admin → 組織管理 / org-admin → フリー設定 / それ以外 → ガイド
  const home = me.isAppAdmin ? PATHS.orgs : isOrgAdmin ? PATHS.freee : PATHS.guide;

  const baseBreadcrumbs = (meta as { breadcrumbs: string[] }).breadcrumbs;

  return (
    <AppShell
      topItems={topItems}
      bottomItems={bottomItems}
      activeItemId={(meta as { id: string }).id}
      breadcrumbs={[...baseBreadcrumbs, ...breadcrumbExtra]}
      actions={headerActions}
    >
      <HeaderActionsContext.Provider value={setHeaderActions}>
        <BreadcrumbExtraContext.Provider value={setBreadcrumbExtra}>
          <Routes>
            <Route path={PATHS.orgs} element={me.isAppAdmin ? <OrgsPage me={me} /> : <Navigate to={home} replace />} />
            <Route
              path={PATHS.freee}
              element={isOrgAdmin ? <FreeeSettingsPage me={me} /> : <Navigate to={home} replace />}
            />
            <Route path={PATHS.users} element={isOrgAdmin ? <MembersPage me={me} /> : <Navigate to={home} replace />} />
            <Route path={PATHS.guide} element={<GptSetupGuide />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </BreadcrumbExtraContext.Provider>
      </HeaderActionsContext.Provider>
    </AppShell>
  );
}

function App() {
  return <Providers>{(signOut) => <Shell signOut={signOut} />}</Providers>;
}

export default App;
