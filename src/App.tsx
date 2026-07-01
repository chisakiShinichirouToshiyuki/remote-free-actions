import { useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { GptSetupGuide } from './GptSetupGuide';

const client = generateClient<Schema>();

type Connection = Schema['FreeeConnection']['type'];

/**
 * 連携画面 (operator-facing). Self sign-up is disabled, so the Authenticator
 * hides the sign-up tab — operators are admin-created. Lists connected freee
 * apps and lets the operator add / connect / re-auth each one.
 *
 * NOTE: "client_secret を設定" and "freee 連携" call backend endpoints added in
 * the follow-up PR (set-freee-secret + freee-oauth-state/redirect). The list /
 * add / remove operations below are live against the FreeeConnection model.
 */
function ConnectionsScreen({ signOut }: { signOut?: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    const sub = client.models.FreeeConnection.observeQuery().subscribe({
      next: (data) => setConnections([...data.items]),
    });
    return () => sub.unsubscribe();
  }, []);

  async function addConnection() {
    const label = window.prompt('接続ラベル(例: 会計 / 顧問先A)');
    if (!label) return;
    const clientId = window.prompt('freee アプリの client_id');
    if (!clientId) return;
    await client.models.FreeeConnection.create({ label, clientId, status: 'needs_reauth' });
  }

  async function removeConnection(id: string) {
    if (!window.confirm('この接続を削除しますか?')) return;
    await client.models.FreeeConnection.delete({ id });
  }

  function setSecret(c: Connection) {
    // TODO(follow-up PR): POST client_secret to set-freee-secret Lambda.
    window.alert(`TODO: ${c.label} の client_secret を Secrets Manager に保存`);
  }

  function connect(c: Connection) {
    // TODO(follow-up PR): issue KMS state → redirect to freee authorize URL.
    window.alert(`TODO: ${c.label} を freee 連携(OAuth authorize へ)`);
  }

  return (
    <main style={{ maxWidth: 760, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>freee 連携</h1>
        <button type="button" onClick={signOut}>
          サインアウト
        </button>
      </header>
      <p>
        GPT お試し用に freee アプリを接続します。1つの操作者が複数アプリ(app-client-id)を
        接続でき、各接続は所属する全顧問先(company_id)を切り替えて操作できます。
      </p>
      <button type="button" onClick={addConnection}>
        + freee アプリを追加
      </button>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {connections.map((c) => (
          <li
            key={c.id}
            style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '8px 0' }}
          >
            <strong>{c.label}</strong>{' '}
            <span style={{ color: c.status === 'connected' ? '#0a7' : '#c40' }}>
              {c.status === 'connected' ? '● 連携済' : '○ 未連携'}
            </span>
            <div style={{ fontSize: 12, color: '#666' }}>client_id: {c.clientId}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setSecret(c)}>
                client_secret を設定
              </button>
              <button type="button" onClick={() => connect(c)}>
                freee 連携
              </button>
              <button type="button" onClick={() => removeConnection(c.id)}>
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Shell({ signOut }: { signOut?: () => void }) {
  const [view, setView] = useState<'connections' | 'guide'>('connections');
  const tab = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    border: 'none',
    borderBottom: active ? '2px solid #0a7' : '2px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });
  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, borderBottom: '1px solid #eee', padding: '8px 16px' }}>
        <button type="button" style={tab(view === 'connections')} onClick={() => setView('connections')}>
          freee 連携
        </button>
        <button type="button" style={tab(view === 'guide')} onClick={() => setView('guide')}>
          GPTs 設定ガイド
        </button>
      </nav>
      {view === 'connections' ? <ConnectionsScreen signOut={signOut} /> : <GptSetupGuide />}
    </div>
  );
}

function App() {
  // hideSignUp: self sign-up is disabled (operators are admin-created).
  return <Authenticator hideSignUp>{({ signOut }) => <Shell signOut={signOut} />}</Authenticator>;
}

export default App;
