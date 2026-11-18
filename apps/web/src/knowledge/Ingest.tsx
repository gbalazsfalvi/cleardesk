import { useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { request } from '../api.js';
import { describeError as describe } from '../errors.js';

export function Ingest({
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
