import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { SessionView } from '@cleardesk/contracts';
import { request } from '../api.js';
import { describeError as describe } from '../errors.js';
import { Brand } from '../components/Brand.js';

export function Login({
  session,
  onLogin,
}: {
  session: SessionView;
  onLogin: (value: SessionView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    try {
      onLogin(
        await request<SessionView>('/api/session', session.csrfToken, {
          username: fields.get('username'),
          password: fields.get('password'),
        }),
      );
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</span>
          <h1>
            Your team knows.
            <br />
            Now you can, too.
          </h1>
          <p>
            Find the answer hiding in your internal knowledge.
            <br />
            With the source, and within the right boundaries.
          </p>
          <div className="login-assurance">
            <ShieldCheck size={18} />
            <span>Workspace-scoped. Source-backed. Read-only.</span>
          </div>
        </div>
        <span className="login-caption">ClearDesk / Internal knowledge assistant</span>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>A clearer working day.</h2>
          <p>Sign in to your knowledge workspace.</p>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={64}
              placeholder="Your username"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              placeholder="Your password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                Open workspace
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="login-note">
            Local reference edition · Fictional organizations
            <br />
            <span className="mode-indicator">
              {session.modelMode === 'live' ? 'Gemini live mode' : 'Offline fixture mode'}
            </span>
          </p>
        </form>
      </section>
    </main>
  );
}
