import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
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
} from '@cleardesk/contracts';
import { request } from '../api.js';
import { ScopeChanged, describeError as describe } from '../errors.js';
import { SafeMarkdown } from '../SafeMarkdown.js';
import { Brand } from '../components/Brand.js';
import { Ingest } from '../knowledge/Ingest.js';
import { Safety } from './Safety.js';
import { starters } from '../chat/starters.js';

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

export function Workspace({ session, onLogout }: { session: SessionView; onLogout: () => void }) {
  const [workspaceId, setWorkspaceId] = useState(session.workspaces[0]?.id ?? '');
  const workspace = session.workspaces.find((value) => value.id === workspaceId)!;
  const [view, setView] = useState<'chat' | 'library' | 'safety' | 'activity'>('chat');
  const [threads, setThreads] = useState<ConversationView[]>([]);
  const [thread, setThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
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
  const threadSequence = useRef(0);
  const selectedWorkspace = useRef(workspaceId);
  selectedWorkspace.current = workspaceId;
  const messageEnd = useRef<HTMLDivElement>(null);
  const sourceClose = useRef<HTMLButtonElement>(null);
  const lastSourceButton = useRef<HTMLElement | null>(null);
  const base = '/api/workspaces/' + workspaceId;
  const api = async <T,>(path: string, body?: unknown, method?: string) => {
    const value = await request<T>(base + path, session.csrfToken, body, method);
    // A legitimate request from the old workspace must never populate the new workspace UI.
    if (selectedWorkspace.current !== workspaceId) throw new ScopeChanged();
    return value;
  };

  useEffect(() => {
    let current = true;
    setThread(null);
    setMessages([]);
    setDocuments([]);
    setKnowledgeLoading(true);
    setThreads([]);
    setSource(null);
    setSourceOpen(false);
    setError('');
    setAdding(false);
    setView('chat');
    sourceSequence.current++;
    threadSequence.current++;
    Promise.all([
      api<{ conversations: ConversationView[] }>('/conversations'),
      api<{ documents: DocumentSummary[] }>('/documents'),
    ])
      .then(([a, b]) => {
        if (current) {
          setThreads(a.conversations);
          setDocuments(b.documents);
          setKnowledgeLoading(false);
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
    const sequence = ++threadSequence.current;
    setError('');
    setSourceOpen(false);
    setThread(id);
    setMessages([]);
    setView('chat');
    setNavOpen(false);
    try {
      const loaded = await api<{ messages: MessageView[] }>('/conversations/' + id + '/messages');
      if (threadSequence.current === sequence) setMessages(loaded.messages);
    } catch (failure) {
      setError(describe(failure));
    }
  }
  async function send(text = question) {
    if (!text.trim() || busy || knowledgeLoading) return;
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
    if (
      document.visibility === 'HR' &&
      !window.confirm('Make “' + document.title + '” visible to every member of this workspace?')
    )
      return;
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
            threadSequence.current++;
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
            Knowledge library
            <span className="count">{knowledgeLoading ? '…' : documents.length}</span>
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
                        disabled={busy || knowledgeLoading}
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
                    {knowledgeLoading
                      ? 'Loading knowledge…'
                      : documents.length + ' accessible sources'}
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
                      disabled={!question.trim() || knowledgeLoading}
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
                      if (selectedWorkspace.current === workspaceId) {
                        setAdding(false);
                        void reloadKnowledge().catch((failure) => setError(describe(failure)));
                      }
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
