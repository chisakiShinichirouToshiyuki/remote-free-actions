import type { ReactNode } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import outputs from '../amplify_outputs.json';
import { Screenshot } from './Screenshot';

type Custom = {
  custom?: {
    bridgeUrl?: string;
    gptOAuth?: { authorizeUrl?: string; tokenUrl?: string; clientId?: string };
  };
};
const custom = (outputs as Custom).custom;
const auth = (outputs as { auth?: { user_pool_id?: string; aws_region?: string } }).auth;
const BRIDGE_URL = custom?.bridgeUrl ?? 'https://<your-bridge-function-url>';
const OPENAPI_URL = `${BRIDGE_URL}openapi`;
const AUTHORIZE_URL = custom?.gptOAuth?.authorizeUrl ?? 'https://<cognito-domain>/oauth2/authorize';
const TOKEN_URL = custom?.gptOAuth?.tokenUrl ?? 'https://<cognito-domain>/oauth2/token';
const GPT_CLIENT_ID = custom?.gptOAuth?.clientId ?? '<gpt-actions-client-id>';
const POOL_ID = auth?.user_pool_id ?? '<user-pool-id>';
const REGION = auth?.aws_region ?? 'ap-northeast-1';
const SCOPE = 'openid email';
const CALLBACK_ENV = 'GPT_OAUTH_CALLBACK_URLS';
const INSTRUCTIONS = 'まず GET /tools でツール一覧を取得し、次に POST /call で実行すること。';
const SECRET_CLI = `aws cognito-idp describe-user-pool-client --user-pool-id ${POOL_ID} --client-id ${GPT_CLIENT_ID} --query 'UserPoolClient.ClientSecret' --output text`;
const COGNITO_CLIENT_URL = `https://${REGION}.console.aws.amazon.com/cognito/v2/idp/user-pools/${POOL_ID}/app-integration/clients/${GPT_CLIENT_ID}?region=${REGION}`;
const GPT_BUILDER_URL = 'https://chatgpt.com/gpts/editor';
const FREEE_DEV_URL = 'https://developer.freee.co.jp/';

// ラベル付きの値 + コピーボタン(フリー設定の CopyBox と同じ体裁)。
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
        {label}
      </Typography>
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
        <Typography sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{value}</Typography>
        <IconButton size="small" aria-label={`${label}をコピー`} onClick={() => void navigator.clipboard.writeText(value)}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noreferrer" sx={{ fontWeight: 500 }}>
      {children}
      <OpenInNewIcon fontSize="inherit" sx={{ ml: 0.25, verticalAlign: 'middle' }} />
    </Link>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Chip label={n} color="primary" size="small" sx={{ fontWeight: 700 }} />
        <Typography variant="h6">{title}</Typography>
      </Stack>
      <Box sx={{ pl: 4.5 }}>{children}</Box>
    </Box>
  );
}

/**
 * 利用者向けガイド: ChatGPT の Custom GPT からこの中継サーバを呼ぶ設定手順。
 * スクリーンショットは仮。public/screenshots/ に画像を置き Screenshot の src を設定する。
 */
export function GptSetupGuide() {
  return (
    <Box sx={{ maxWidth: 860 }}>
      <Typography variant="h4" gutterBottom>
        ChatGPT 接続ガイド
      </Typography>
      <Typography sx={{ mb: 2 }}>
        ChatGPT の Custom GPT からこのサービスを呼び出す設定手順です。ログインは初回のみ別タブで行い、以降は自動です。
        利用者アカウントは組織管理者が「ユーザー管理」でメールアドレスから発行します。
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        入力する値はすべて、下のコピーボタンからそのまま貼り付けられます。
      </Alert>

      <Typography variant="h6" gutterBottom>
        用意するもの
      </Typography>
      <Box sx={{ mb: 3 }}>
        <CopyField label="仕様(GPT の「スキーマ」欄に貼る内容の取得先。ログイン済みで開く)" value={OPENAPI_URL} />
        <Typography variant="body2" color="text.secondary">
          シークレットは <Ext href={COGNITO_CLIENT_URL}>設定画面</Ext> か、下のコマンドで取得します。
        </Typography>
        <Box sx={{ mt: 1 }}>
          <CopyField label="シークレット取得コマンド" value={SECRET_CLI} />
        </Box>
      </Box>

      <Typography variant="h6" gutterBottom>
        手順
      </Typography>

      <Step n={1} title="GPT を作成し、アクションを追加">
        <Typography sx={{ mb: 1 }}>
          <Ext href={GPT_BUILDER_URL}>GPT 作成画面</Ext> を開き、「設定」→「アクション」→「新しいアクションを作成」と進みます。
        </Typography>
        <Screenshot
          title="① GPT を作成 → アクションを追加"
          alt="ChatGPT の GPT 作成画面の設定タブでアクションの新規作成を押した画面"
          caption="設定 → アクション → 新しいアクションを作成"
        />
      </Step>

      <Step n={2} title="仕様(スキーマ)を貼り付け">
        <Typography sx={{ mb: 1 }}>
          「スキーマ」欄に、下の URL を開いて表示された内容を貼り付けます。先頭の接続先 URL がこのサービスの URL
          であることを確認してください。
        </Typography>
        <CopyField label="仕様の取得先" value={OPENAPI_URL} />
        <Screenshot
          title="② 仕様(スキーマ)を貼り付け"
          alt="GPT アクションのスキーマ欄にこのサービスの仕様を貼り付けた画面"
          caption="「スキーマ」欄に貼り付け"
        />
      </Step>

      <Step n={3} title="ログイン方式を設定">
        <Typography sx={{ mb: 1 }}>
          認証で「OAuth」を選び、以下を入力します(シークレットは「用意するもの」で取得した値)。
        </Typography>
        <CopyField label="クライアント ID" value={GPT_CLIENT_ID} />
        <CopyField label="認可 URL" value={AUTHORIZE_URL} />
        <CopyField label="トークン URL" value={TOKEN_URL} />
        <CopyField label="スコープ" value={SCOPE} />
        <Typography variant="body2" color="text.secondary">
          トークン交換方式は「Default (POST)」のままで構いません。
        </Typography>
        <Screenshot
          title="③ ログイン方式(OAuth)を設定"
          alt="GPT アクションの認証で OAuth を選び、クライアント ID・シークレット・各 URL・スコープを入力した画面"
          caption="認証 → OAuth。各 URL とクライアントを入力"
        />
      </Step>

      <Step n={4} title="折り返し先 URL を登録">
        <Typography sx={{ mb: 1 }}>
          GPT を保存すると折り返し先(コールバック)URL が表示されます。
          <strong>設定画面で直接編集しないでください</strong>(次の反映で元に戻ります)。下の環境変数に設定して、
          もう一度反映します。
        </Typography>
        <CopyField label="設定する環境変数名" value={CALLBACK_ENV} />
        <Screenshot
          title="④ 折り返し先 URL を登録"
          alt="GPT 保存後に表示された折り返し先 URL を環境変数に設定した画面"
          caption="表示された URL を環境変数に設定して再反映"
        />
      </Step>

      <Step n={5} title="指示文を設定">
        <Typography sx={{ mb: 1 }}>「指示文」欄に、ツールの呼び方(まず一覧取得 → 実行)を書きます。</Typography>
        <CopyField label="貼り付ける指示文(例)" value={INSTRUCTIONS} />
        <Screenshot
          title="⑤ 指示文を設定"
          alt="GPT の指示文欄に、まず一覧取得し次に実行する手順を貼り付けた画面"
          caption="「まず一覧取得 → 実行」を明記"
        />
      </Step>

      <Step n={6} title="テスト:ログイン → ツール実行">
        <Typography sx={{ mb: 1 }}>
          アクションを初めて実行すると別タブでログインを求められます。ログインすると freee のツールが動きます。
          以降はログイン状態が保持されます。
        </Typography>
        <Screenshot
          title="⑥ テスト:ログイン → ツール実行"
          alt="GPT でアクションを初回実行しログインした後、freee ツールが動作した画面"
          caption="初回のみログイン → 以降は自動"
        />
      </Step>

      <Typography variant="h6" gutterBottom>
        うまくいかない時
      </Typography>
      <Stack spacing={1}>
        <Alert severity="warning">
          <strong>権限エラー(401)</strong> — ログインが切れています。GPT で再度ログインしてください。
        </Alert>
        <Alert severity="warning">
          <strong>ログインできない</strong> — 利用者アカウントが未発行です。組織管理者に「ユーザー管理」での追加を
          依頼してください。
        </Alert>
        <Alert severity="warning">
          <strong>freee が未接続と出る</strong> — 組織管理者が「フリー設定」で freee アプリを登録・認可してください。
        </Alert>
        <Alert severity="warning">
          <strong>組織が停止中と出る</strong> — その組織に有効な組織管理者がいません(自動で停止扱い)。
        </Alert>
      </Stack>

      <Box sx={{ mt: 3 }}>
        <Typography variant="body2" color="text.secondary">
          参考: <Ext href={FREEE_DEV_URL}>freee アプリの作成(freee 開発者サイト)</Ext>
        </Typography>
      </Box>
    </Box>
  );
}
