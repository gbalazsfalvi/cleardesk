import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  FolderClosed,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ConversationView,
  DocumentSummary,
  MessageView,
  SessionView,
  SourceCitation,
  SourceView,
  TurnReply,
  WorkspaceView,
} from '@cleardesk/contracts';
import { request } from './api.js';
import { SafeMarkdown } from './SafeMarkdown.js';

const describe = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
const starters = [
  { icon: FolderClosed, category: 'GET SETTLED', question: 'What is our hybrid work policy?' },
  { icon: FileText, category: 'FIND THE DETAILS', question: 'How do I claim travel expenses?' },
  {
    icon: ShieldCheck,
    category: 'STAY PREPARED',
    question: 'What should I do if I lose my work device?',
  },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>
        cleardesk<span className="brand-dot">.</span>
      </span>
    </div>
  );
}

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

function Login({
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

function Workspace({ session, onLogout }: { session: SessionView; onLogout: () => void }) {
  const [workspaceId, setWorkspaceId] = useState(session.workspaces[0]?.id ?? '');
  const workspace = session.workspaces.find((value) => value.id === workspaceId)!;
  const [view, setView] = useState<'chat' | 'library' | 'safety' | 'activity'>('chat');
  const [threads, setThreads] = useState<ConversationView[]>([]);
  const [thread, setThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<SourceView | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [events, setEvents] = useState<{ id: string; code: string; createdAt: string }[]>([]);
  const sourceSequence = useRef(0);
  const messageEnd = useRef<HTMLDivElement>(null);
  const sourceClose = useRef<HTMLButtonElement>(null);
  const lastSourceButton = useRef<HTMLElement | null>(null);
  const base = '/api/workspaces/' + workspaceId;
  const api = <T,>(path: string, body?: unknown, method?: string) =>
    request<T>(base + path, session.csrfToken, body, method);

  useEffect(() => {
    let current = true;
    setThread(null);
    setMessages([]);
    setDocuments([]);
    setThreads([]);
    setSource(null);
    setSourceOpen(false);
    setError('');
    setAdding(false);
    setView('chat');
    sourceSequence.current++;
    Promise.all([
      api<{ conversations: ConversationView[] }>('/conversations'),
      api<{ documents: DocumentSummary[] }>('/documents'),
    ])
      .then(([a, b]) => {
        if (current) {
          setThreads(a.conversations);
          setDocuments(b.documents);
        }
      })
      .catch((failure) => {
        if (current) setError(describe(failure));
      });
    return () => {
      current = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);
  useEffect(() => {
    if (sourceOpen) sourceClose.current?.focus();
  }, [sourceOpen]);

  async function reloadKnowledge() {
    setDocuments((await api<{ documents: DocumentSummary[] }>('/documents')).documents);
  }
  async function selectThread(id: string) {
    if (busy) return;
    setError('');
    setSourceOpen(false);
    setThread(id);
    setMessages([]);
    setView('chat');
    setNavOpen(false);
    try {
      setMessages(
        (await api<{ messages: MessageView[] }>('/conversations/' + id + '/messages')).messages,
      );
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function send(text = question) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    setQuestion('');
    setView('chat');
    setNavOpen(false);
    let current = thread;
    try {
      if (!current) {
        current = (await api<{ conversation: ConversationView }>('/conversations', {})).conversation
          .id;
        setThread(current);
      }
      setMessages((previous) => [
        ...previous,
        {
          id: 'pending-user',
          role: 'user',
          text,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          sources: [],
        },
      ]);
      await api<TurnReply>('/conversations/' + current + '/turns', {
        question: text,
        requestKey: crypto.randomUUID(),
      });
    } catch (failure) {
      setError(describe(failure));
    } finally {
      if (current) {
        try {
          setMessages(
            (await api<{ messages: MessageView[] }>('/conversations/' + current + '/messages'))
              .messages,
          );
          setThreads(
            (await api<{ conversations: ConversationView[] }>('/conversations')).conversations,
          );
        } catch (failure) {
          setError(describe(failure));
        }
      }
      setBusy(false);
    }
  }
  async function cancel() {
    if (!thread) return;
    try {
      const history = await api<{ messages: MessageView[] }>(
        '/conversations/' + thread + '/messages',
      );
      const pending = history.messages.find(
        (message) => message.role === 'assistant' && message.status === 'PENDING',
      );
      if (pending) await api('/conversations/' + thread + '/turns/' + pending.id + '/cancel', {});
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function openSource(documentId: string, chunkId?: string) {
    const sequence = ++sourceSequence.current;
    lastSourceButton.current = document.activeElement as HTMLElement;
    setSourceOpen(true);
    setSource(null);
    setSourceError('');
    try {
      const value = await api<{ source: SourceView }>(
        '/sources/' + documentId + (chunkId ? '?chunkId=' + chunkId : ''),
      );
      if (sequence === sourceSequence.current) setSource(value.source);
    } catch (failure) {
      if (sequence === sourceSequence.current) setSourceError(describe(failure));
    }
  }
  function closeSource() {
    sourceSequence.current++;
    setSourceOpen(false);
    lastSourceButton.current?.focus();
  }
  async function changeVisibility(document: DocumentSummary) {
    try {
      await api(
        '/documents/' + document.id + '/acl',
        { visibility: document.visibility === 'HR' ? 'WORKSPACE' : 'HR' },
        'PATCH',
      );
      await reloadKnowledge();
      if (thread)
        setMessages(
          (await api<{ messages: MessageView[] }>('/conversations/' + thread + '/messages'))
            .messages,
        );
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function removeDocument(document: DocumentSummary) {
    if (
      !window.confirm(
        'Remove “' +
          document.title +
          '” from accessible knowledge? Dependent answers will be hidden.',
      )
    )
      return;
    try {
      await api('/documents/' + document.id, undefined, 'DELETE');
      await reloadKnowledge();
      setSourceOpen(false);
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function showActivity() {
    setView('activity');
    setNavOpen(false);
    try {
      setEvents((await api<{ events: typeof events }>('/activity')).events);
    } catch (failure) {
      setError(describe(failure));
    }
  }
  if (!workspace)
    return (
      <main className="boot">
        <Brand />
        <p>No workspace membership is available.</p>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (navOpen ? 'nav-open' : '')}>
        <Brand />
        <div className="workspace-picker">
          <span className="workspace-icon">{workspace.name[0]}</span>
          <label className="sr-only" htmlFor="workspace">
            Current workspace
          </label>
          <select
            id="workspace"
            value={workspaceId}
            disabled={busy}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {session.workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <button
          className="new-chat"
          disabled={busy}
          onClick={() => {
            setThread(null);
            setMessages([]);
            setSourceOpen(false);
            setView('chat');
            setError('');
            setNavOpen(false);
          }}
        >
          <Plus size={17} />
          New conversation<span>＋</span>
        </button>
        <div className="rail-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={view === 'chat' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setView('chat');
              setNavOpen(false);
            }}
          >
            <MessageSquare size={17} />
            Ask ClearDesk
          </button>
          <button
            className={view === 'library' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setView('library');
              setNavOpen(false);
            }}
          >
            <BookOpen size={17} />
            Knowledge library<span className="count">{documents.length}</span>
          </button>
          <button
            className={view === 'safety' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setView('safety');
              setNavOpen(false);
            }}
          >
            <ShieldCheck size={17} />
            Trust & boundaries
          </button>
          {workspace.role === 'ADMIN' && (
            <button
              className={view === 'activity' ? 'nav-item active' : 'nav-item'}
              onClick={() => void showActivity()}
            >
              <SlidersHorizontal size={17} />
              Activity
            </button>
          )}
        </nav>
        <div className="rail-label recent-label">RECENT CONVERSATIONS</div>
        <div className="threads">
          {threads.length ? (
            threads.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={'thread-item ' + (item.id === thread ? 'selected' : '')}
                onClick={() => void selectThread(item.id)}
              >
                <MessageSquare size={14} />
                <span>{item.title}</span>
              </button>
            ))
          ) : (
            <p className="rail-empty">A good question starts here.</p>
          )}
        </div>
        <div className="rail-footer">
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>
              Your workspace.
              <br />
              <strong>Your access boundaries.</strong>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">{initials(session.actor!.displayName)}</span>
            <div>
              <strong>{session.actor!.displayName}</strong>
              <span>
                {workspace.role === 'HR'
                  ? 'People team'
                  : workspace.role === 'ADMIN'
                    ? 'Workspace administrator'
                    : 'Workspace member'}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => {
                void request('/api/logout', session.csrfToken, {})
                  .then(onLogout)
                  .catch((failure) => setError(describe(failure)));
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            {workspace.name}
            <span>/</span>
            <strong>
              {view === 'chat'
                ? 'Ask ClearDesk'
                : view === 'library'
                  ? 'Knowledge library'
                  : view === 'activity'
                    ? 'Activity'
                    : 'Trust & boundaries'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="workspace-status">
              <span />
              Workspace-scoped
            </span>
            <span className={'mode-badge ' + session.modelMode}>
              {session.modelMode === 'live' ? 'Gemini · live' : 'Offline fixture'}
            </span>
          </div>
        </header>
        {view === 'chat' ? (
          <main
            className={'chat-view ' + (messages.length ? 'has-messages' : '')}
            id="main-content"
          >
            <div className="chat-scroll">
              {messages.length === 0 ? (
                <section className="welcome">
                  <div className="assistant-symbol">
                    <Brand />
                  </div>
                  <div className="welcome-kicker">
                    <span />
                    KNOWLEDGE, WITH CONTEXT
                  </div>
                  <h1>
                    Less searching.
                    <br />
                    <span>More knowing.</span>
                  </h1>
                  <p>
                    Ask a question. Get a clear answer from your team’s
                    <br className="desktop-break" /> knowledge, with sources you can actually open.
                  </p>
                  <div className="starter-grid">
                    {starters.map(({ icon: Icon, category, question: prompt }) => (
                      <button
                        key={category}
                        className="starter"
                        disabled={busy}
                        onClick={() => void send(prompt)}
                      >
                        <Icon size={19} />
                        <span>{category}</span>
                        <strong>{prompt}</strong>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-footnote">
                    <ShieldCheck size={14} />
                    <span>Answers use only knowledge available to you in {workspace.name}.</span>
                  </div>
                </section>
              ) : (
                <section className="message-list" aria-label="Conversation">
                  {messages.map((message) => (
                    <article key={message.id} className={'message ' + message.role}>
                      <span className={'message-avatar ' + message.role}>
                        {message.role === 'user' ? (
                          initials(session.actor!.displayName)
                        ) : (
                          <span className="mini-c">c.</span>
                        )}
                      </span>
                      <div className="message-body">
                        <div className="message-meta">
                          <strong>{message.role === 'user' ? 'You' : 'ClearDesk'}</strong>
                          {message.role === 'assistant' && (
                            <span>
                              {message.status === 'ANSWERED'
                                ? 'Source-backed'
                                : message.status.replaceAll('_', ' ').toLowerCase()}
                            </span>
                          )}
                        </div>
                        <SafeMarkdown text={message.text} />
                        {message.sources.length > 0 && (
                          <div className="sources">
                            <span className="sources-label">
                              SOURCES · {message.sources.length}
                            </span>
                            {message.sources.map((citation: SourceCitation, index) => (
                              <button
                                key={citation.chunkId}
                                className="source-chip"
                                onClick={() =>
                                  void openSource(citation.documentId, citation.chunkId)
                                }
                              >
                                <span>{index + 1}</span>
                                <FileText size={14} />
                                {citation.title}
                                <ArrowRight size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                  {busy && (
                    <div className="thinking" role="status">
                      <LoaderCircle size={17} className="spin" />
                      <span>Checking your workspace knowledge…</span>
                    </div>
                  )}
                  <div ref={messageEnd} />
                </section>
              )}
            </div>
            <div className="composer-area">
              {error && (
                <div className="error banner" role="alert">
                  {error}
                  <button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => setError('')}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label className="sr-only" htmlFor="question">
                  Ask your workspace knowledge
                </label>
                <textarea
                  id="question"
                  value={question}
                  maxLength={2000}
                  disabled={busy}
                  placeholder="What would you like to know?"
                  rows={2}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <span>
                    <BookOpen size={14} />
                    {documents.length} accessible sources
                    <span className="toolbar-separator">·</span>
                    {workspace.name}
                  </span>
                  {busy ? (
                    <button
                      type="button"
                      className="send-button cancel"
                      aria-label="Cancel answer"
                      onClick={() => void cancel()}
                    >
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      aria-label="Send question"
                      disabled={!question.trim()}
                    >
                      <ArrowRight size={20} />
                    </button>
                  )}
                </div>
              </form>
              <div className="composer-note">
                <span>ClearDesk can make mistakes. Check the sources.</span>
                <span>
                  Enter to send <span className="keycap">↵</span>
                </span>
              </div>
            </div>
          </main>
        ) : (
          <main className="page-view" id="main-content">
            {error && (
              <p className="error banner" role="alert">
                {error}
              </p>
            )}
            {view === 'library' ? (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">YOUR WORKSPACE KNOWLEDGE</span>
                    <h1>The source of clarity.</h1>
                    <p>Documents you can access in {workspace.name}.</p>
                  </div>
                  {workspace.role === 'ADMIN' && (
                    <button className="button primary" onClick={() => setAdding(!adding)}>
                      <Plus size={16} />
                      Add document
                    </button>
                  )}
                </div>
                {adding && (
                  <Ingest
                    csrf={session.csrfToken}
                    base={base}
                    onClose={() => setAdding(false)}
                    onSaved={() => {
                      setAdding(false);
                      void reloadKnowledge();
                    }}
                  />
                )}
                <div className="library-summary">
                  <span>
                    <BookOpen size={17} />
                    {documents.length} accessible documents
                  </span>
                  <span>
                    <ShieldCheck size={15} />
                    {workspace.role === 'MEMBER'
                      ? 'Workspace-visible knowledge'
                      : 'Includes restricted People knowledge'}
                  </span>
                </div>
                <div className="document-list">
                  {documents.map((document) => (
                    <article className="document-row" key={document.id}>
                      <span className="file-icon">
                        <FileText size={22} />
                      </span>
                      <button
                        className="document-name"
                        onClick={() => void openSource(document.id)}
                      >
                        <strong>{document.title}</strong>
                        <span>
                          {document.chunkCount} {document.chunkCount === 1 ? 'chunk' : 'chunks'}
                          <span>·</span>Version 1<span>·</span>SHA{' '}
                          {document.contentSha256.slice(0, 8)}
                        </span>
                      </button>
                      <span className={'visibility ' + document.visibility.toLowerCase()}>
                        {document.visibility === 'HR' ? 'People · restricted' : 'Workspace'}
                      </span>
                      {workspace.role === 'ADMIN' && (
                        <div className="document-actions">
                          <button
                            className="icon-button"
                            title="Change document visibility"
                            aria-label={'Change visibility: ' + document.title}
                            onClick={() => void changeVisibility(document)}
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={'Remove: ' + document.title}
                            onClick={() => void removeDocument(document)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                      <button
                        className="icon-button document-open"
                        aria-label={'Open: ' + document.title}
                        onClick={() => void openSource(document.id)}
                      >
                        <ArrowRight size={18} />
                      </button>
                    </article>
                  ))}
                </div>
                <p className="section-note">
                  Sources are checked again when you open them. Access changes also apply to saved
                  answers.
                </p>
              </>
            ) : view === 'safety' ? (
              <Safety workspace={workspace} mode={session.modelMode} />
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">ADMINISTRATION</span>
                    <h1>A little accountability.</h1>
                    <p>Safe event metadata. No raw prompts, documents or credentials.</p>
                  </div>
                </div>
                <div className="activity-table">
                  {events.length ? (
                    events.map((event) => (
                      <div key={event.id}>
                        <span className="activity-icon">
                          <Check size={16} />
                        </span>
                        <strong>{event.code.replaceAll('_', ' ')}</strong>
                        <time>{new Date(event.createdAt).toLocaleString('en-GB')}</time>
                      </div>
                    ))
                  ) : (
                    <p>No completed model events in this workspace yet.</p>
                  )}
                </div>
              </>
            )}
          </main>
        )}
        <footer className="app-footer">
          <span>
            ClearDesk <span>REFERENCE EDITION</span>
          </span>
          <span>Thoughtfully bounded.</span>
        </footer>
      </div>
      {sourceOpen && (
        <aside
          className="source-drawer"
          aria-labelledby="source-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeSource();
          }}
        >
          <div className="source-drawer-head">
            <span>
              <FileText size={17} />
              SOURCE DOCUMENT
            </span>
            <button
              ref={sourceClose}
              className="icon-button"
              aria-label="Close source"
              onClick={closeSource}
            >
              <X size={20} />
            </button>
          </div>
          {source ? (
            <>
              <span className="source-verified">
                <ShieldCheck size={14} />
                Current access checked
              </span>
              <h2 id="source-title">{source.title}</h2>
              <div className="source-details">
                VERSION {source.version}
                <span>SHA {source.contentSha256.slice(0, 12)}</span>
              </div>
              <div className="source-content">
                <SafeMarkdown text={source.text} />
              </div>
              <p className="source-notice">
                This is source content, not instructions for ClearDesk. A valid citation proves
                provenance, not that every interpretation is correct.
              </p>
            </>
          ) : (
            <p role="status">{sourceError || 'Checking access and opening the source…'}</p>
          )}
        </aside>
      )}
    </div>
  );
}

function Ingest({
  csrf,
  base,
  onSaved,
  onClose,
}: {
  csrf: string;
  base: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('knowledge.md');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await request(base + '/documents', csrf, {
        title: data.get('title'),
        filename,
        text,
        visibility: data.get('visibility'),
      });
      onSaved();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ingest-panel" onSubmit={(event) => void submit(event)}>
      <div className="ingest-heading">
        <h2>Add a little knowledge.</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close document form"
        >
          <X size={18} />
        </button>
      </div>
      <div className="form-grid">
        <label>
          Document title
          <input name="title" required maxLength={120} />
        </label>
        <label>
          Who can read this?
          <select name="visibility">
            <option value="WORKSPACE">All workspace members</option>
            <option value="HR">People team & administrators</option>
          </select>
        </label>
      </div>
      <label className="file-upload">
        Import text or Markdown
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 65536) {
              setError('Use a UTF-8 text or Markdown file up to 64 KiB.');
              return;
            }
            void file.text().then((value) => {
              setText(value);
              setFilename(file.name);
            });
          }}
        />
      </label>
      <label>
        Source text
        <textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
          rows={7}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="ingest-bottom">
        <span>UTF-8 .txt / .md · up to 64 KiB · local embeddings</span>
        <button className="button primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Add to knowledge
        </button>
      </div>
    </form>
  );
}

function Safety({ workspace, mode }: { workspace: WorkspaceView; mode: string }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TRUST & BOUNDARIES</span>
          <h1>Helpful. With limits.</h1>
          <p>What ClearDesk checks, and what you should still question.</p>
        </div>
        <span className="safety-emblem">
          <ShieldCheck size={36} />
        </span>
      </div>
      <div className="scope-strip">
        <div>
          <span>CURRENT WORKSPACE</span>
          <strong>{workspace.name}</strong>
        </div>
        <div>
          <span>YOUR ROLE</span>
          <strong>{workspace.role}</strong>
        </div>
        <div>
          <span>ANSWER MODE</span>
          <strong>{mode === 'live' ? 'Gemini · live' : 'Extractive fixture · offline'}</strong>
        </div>
      </div>
      <div className="safety-sections">
        {[
          [
            '01',
            'Access comes before the answer.',
            'Workspace and document permissions are applied before retrieval ranking. The model cannot change your role or select a different authority context.',
          ],
          [
            '02',
            'Every source has a paper trail.',
            'Citations must refer to authorized chunks the model actually received. Source titles, excerpts and links are constructed by the server. This proves provenance, not semantic correctness.',
          ],
          [
            '03',
            'Knowledge can change. Access does, too.',
            'Permissions are checked before model dispatch and before an answer is saved or returned. Saved answers depending on newly restricted documents are hidden and excluded from future context. Already dispatched provider content cannot be recalled.',
          ],
          [
            '04',
            'An assistant, with no action button.',
            'The model can search and read. It cannot send emails, fetch arbitrary URLs, execute code, query SQL or change your knowledge library. Document administration stays with a human administrator.',
          ],
          [
            '05',
            'Honest about its limits.',
            'Prompt injection remains a model-level risk. Server-enforced boundaries limit its authority; they do not make all generated text true. Read the source before relying on an answer. This local reference uses fictional data and is not a production compliance claim.',
          ],
        ].map(([number, title, text]) => (
          <section key={number}>
            <span>{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
