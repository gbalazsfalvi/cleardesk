import { ShieldCheck } from 'lucide-react';
import type { WorkspaceView } from '@cleardesk/contracts';

export function Safety({ workspace, mode }: { workspace: WorkspaceView; mode: string }) {
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
