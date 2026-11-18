import { useEffect, useState } from 'react';
import type { SessionView } from '@cleardesk/contracts';
import { request } from './api.js';
import { describeError as describe } from './errors.js';
import { Brand } from './components/Brand.js';
import { Login } from './session/Login.js';
import { Workspace } from './workspace/Workspace.js';

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setSession(await request<SessionView>('/api/session', ''));
    } catch (failure) {
      setError(describe(failure));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  if (!session)
    return (
      <div className="boot">
        <Brand />
        <p role="status">{error || 'Opening your workspace…'}</p>
        {error && <button onClick={() => void refresh()}>Try again</button>}
      </div>
    );
  return session.authenticated ? (
    <Workspace
      key={session.actor!.id}
      session={session}
      onLogout={() => {
        setSession(null);
        void refresh();
      }}
    />
  ) : (
    <Login session={session} onLogin={setSession} />
  );
}
