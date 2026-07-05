import outputs from '../amplify_outputs.json';
import { Screenshot } from './Screenshot';

type Custom = {
  custom?: {
    bridgeUrl?: string;
    gptOAuth?: { authorizeUrl?: string; tokenUrl?: string; clientId?: string };
  };
};
const custom = (outputs as Custom).custom;
const BRIDGE_URL = custom?.bridgeUrl ?? 'https://<your-bridge-function-url>';
const AUTHORIZE_URL = custom?.gptOAuth?.authorizeUrl ?? 'https://<cognito-domain>/oauth2/authorize';
const TOKEN_URL = custom?.gptOAuth?.tokenUrl ?? 'https://<cognito-domain>/oauth2/token';
const GPT_CLIENT_ID = custom?.gptOAuth?.clientId ?? '<gpt-actions-client-id>';

const code: React.CSSProperties = {
  background: '#f1f5f9',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 13,
  wordBreak: 'break-all',
};

/**
 * Operator-facing guide: how to wire a ChatGPT Custom GPT to this bridge using
 * Cognito OAuth. Screenshots are placeholders — drop PNGs into
 * public/screenshots/ and set each Screenshot's `src`.
 */
export function GptSetupGuide() {
  return (
    <section style={{ maxWidth: 820, margin: '1rem auto', fontFamily: 'system-ui', lineHeight: 1.7 }}>
      <h1>GPTs 接続ガイド</h1>
      <p>
        ChatGPT の Custom GPT からこの bridge を呼び出す設定手順です。認証は Cognito OAuth(初回のみ別タブでログイン、以降は自動)。
        利用者アカウントは app-admin が発行します。
      </p>

      <h2>前提</h2>
      <ul>
        <li>
          bridge の Function URL: <code style={code}>{BRIDGE_URL}</code>
        </li>
        <li>OpenAPI は bridge が生成: <code style={code}>GET {BRIDGE_URL}openapi</code>(要 Cognito トークン)</li>
        <li>Cognito のアプリクライアント(client secret 付き)と managed login ドメインが必要</li>
      </ul>

      <h2>手順</h2>

      <ol>
        <li>
          <strong>GPT を作成し Action を追加</strong>
          <Screenshot
            title="① GPT を作成 → Actions を追加"
            alt="ChatGPT の GPT Builder の Configure タブで Actions セクションの Create new action を押した画面"
            caption="GPT Builder → Configure → Actions → Create new action"
          />
        </li>
        <li>
          <strong>OpenAPI スキーマを取り込む</strong>(<code style={code}>{BRIDGE_URL}openapi</code> の内容を貼付)
          <Screenshot
            title="② OpenAPI スキーマを貼り付け"
            alt="GPT Action の Schema 欄に bridge の OpenAPI(GET /tools・POST /call)を貼り付けた画面"
            caption="Schema 欄に bridge の OpenAPI を貼付。servers[].url が bridge の URL であることを確認"
          />
        </li>
        <li>
          <strong>Authentication を OAuth(Cognito)に設定</strong>
          <ul>
            <li>
              Client ID = <code style={code}>{GPT_CLIENT_ID}</code>(Secret は AWS console/CLI の
              GptActionsClient から取得)
            </li>
            <li>
              Authorization URL = <code style={code}>{AUTHORIZE_URL}</code>
            </li>
            <li>
              Token URL = <code style={code}>{TOKEN_URL}</code>
            </li>
            <li>Scope = <code style={code}>openid email</code>、Token Exchange = Default (POST)</li>
          </ul>
          <Screenshot
            title="③ 認証を OAuth(Cognito)に設定"
            alt="GPT Action の Authentication ダイアログで OAuth を選び Client ID/Secret・Authorization URL・Token URL・Scope を入力した画面"
            caption="Authentication → OAuth。Cognito の authorize/token エンドポイントと client を入力"
          />
        </li>
        <li>
          <strong>コールバック URL を登録</strong>(GPT 保存後に表示される URL)—
          console で直接編集しない(次の deploy で IaC に戻される)。branch env{' '}
          <code style={code}>GPT_OAUTH_CALLBACK_URLS</code> に設定して再 deploy する
          <Screenshot
            title="④ コールバックURLを Cognito に登録"
            alt="GPT 保存後に表示されたコールバックURLを Cognito アプリクライアントの Allowed callback URLs に追加した画面"
            caption="GPT を保存 → 表示された callback URL を Cognito の Allowed callback URLs に追加"
          />
        </li>
        <li>
          <strong>Instructions を設定</strong>(/tools → /call のハンドシェイクを明記)
          <Screenshot
            title="⑤ Instructions を設定"
            alt="GPT の Instructions 欄に、まず /tools を呼び次に /call を呼ぶ手順を貼り付けた画面"
            caption="「まず listTools(/tools)で一覧取得 → callTool(/call)で実行」を明記"
          />
        </li>
        <li>
          <strong>テスト</strong>:アクション初回実行 → Cognito ログイン(別タブ)→ ツール動作
          <Screenshot
            title="⑥ テスト:Cognito ログイン → ツール実行"
            alt="GPT でアクションを初回実行し Sign in から Cognito にログインした後、freee ツールが動作した画面"
            caption="初回のみ Cognito ログイン(別タブ)→ トークンはキャッシュされ以降サイレント"
          />
        </li>
      </ol>

      <h2>トラブルシュート</h2>
      <ul>
        <li>401 が返る → Cognito トークン未取得/失効。GPT で再サインイン</li>
        <li>ログインできない → 利用者の Cognito アカウントが未発行(app-admin が発行)</li>
        <li>
          freee 呼び出しが「not connected / needs re-authorization」→ org-admin が freee を未接続。
          <code style={code}>registerFreeeApp</code> → <code style={code}>startFreeeAuthorize</code>{' '}
          で接続(GUI は準備中)
        </li>
        <li>「organization is suspended」→ org に active な org-admin が居ない(reconciler が停止中に設定)</li>
      </ul>
    </section>
  );
}
