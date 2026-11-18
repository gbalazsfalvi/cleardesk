import { z } from 'zod';

/** Fixed, inspectable limits shared by public request handlers and the product UI. */
export const LIMITS = Object.freeze({
  questionCharacters: 2000,
  documentBytes: 65536,
  documentRequestBytes: 262144,
  chatRequestBytes: 16384,
  titleCharacters: 120,
  searchCharacters: 500,
  retrievedChunks: 6,
  documentsPerWorkspace: 30,
  chunksPerWorkspace: 2000,
  chunksPerDocument: 128,
  chunkCharacters: 1000,
  chunkOverlapCharacters: 150,
  modelOutputTokens: 512,
  modelSteps: 2,
});

/** Reject malformed Unicode before hashing, embedding or crossing the Python boundary. */
function wellFormedUnicode(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

const uuid = z.string().uuid();
const title = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.titleCharacters)
  .refine(wellFormedUnicode, 'Invalid Unicode')
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Control characters are not allowed');

export const role = z.enum(['MEMBER', 'HR', 'ADMIN']);
export const visibility = z.enum(['WORKSPACE', 'HR']);
export type Role = z.infer<typeof role>;
export type Visibility = z.infer<typeof visibility>;
export type ModelMode = 'fixture' | 'live';

export const loginInput = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9._-]+$/),
    password: z.string().min(1).max(256).refine(wellFormedUnicode, 'Invalid Unicode'),
  })
  .strict();

export const documentInput = z
  .object({
    title,
    filename: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[^/\\\u0000-\u001f\u007f]+\.(?:txt|md)$/i, 'Use a plain text or Markdown filename')
      .refine(wellFormedUnicode, 'Invalid Unicode'),
    text: z
      .string()
      .min(1)
      .refine(wellFormedUnicode, 'Invalid Unicode')
      .refine((value) => value.trim().length > 0, 'The document is empty')
      .refine((value) => !value.includes('\0'), 'NUL is not allowed')
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= LIMITS.documentBytes,
        'Document exceeds 64 KiB',
      ),
    visibility,
  })
  .strict();

export const aclInput = z.object({ visibility }).strict();
export const conversationInput = z.object({ title: title.optional() }).strict();
export const turnInput = z
  .object({
    question: z
      .string()
      .min(1)
      .max(LIMITS.questionCharacters)
      .refine((value) => value.trim().length > 0, 'The question is empty')
      .refine(wellFormedUnicode, 'Invalid Unicode'),
    requestKey: uuid,
  })
  .strict();

/** Tools accept search content, never credentials or an alternative authority context. */
export const searchInput = z
  .object({
    query: z.string().trim().min(1).max(LIMITS.searchCharacters).refine(wellFormedUnicode),
    limit: z.number().int().min(1).max(LIMITS.retrievedChunks).default(4),
  })
  .strict();
export const readSourceInput = z.object({ sourceId: uuid }).strict();

/** Model output identifies sources; the server constructs trusted citation content and links. */
export const modelAnswer = z
  .object({
    kind: z.enum(['answer', 'insufficient']),
    answer: z.string().min(1).max(6000).refine(wellFormedUnicode),
    citations: z.array(z.object({ documentId: uuid, chunkId: uuid }).strict()).max(6),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'answer' && value.citations.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['citations'],
        message: 'An answer needs a source',
      });
    if (value.kind === 'insufficient' && value.citations.length !== 0)
      context.addIssue({
        code: 'custom',
        path: ['citations'],
        message: 'Insufficient knowledge has no asserted sources',
      });
  });
export type ModelAnswer = z.infer<typeof modelAnswer>;
export type DocumentInput = z.infer<typeof documentInput>;

export interface ActorView {
  id: string;
  username: string;
  displayName: string;
}
export interface WorkspaceView {
  id: string;
  name: string;
  role: Role;
}
export interface SessionView {
  authenticated: boolean;
  csrfToken: string;
  actor: ActorView | null;
  workspaces: WorkspaceView[];
  modelMode: ModelMode;
}
export interface DocumentSummary {
  id: string;
  title: string;
  visibility: Visibility;
  contentSha256: string;
  createdAt: string;
  chunkCount: number;
}
export interface SourceCitation {
  documentId: string;
  chunkId: string;
  title: string;
  excerpt: string;
  href: string;
  contentSha256: string;
}
export interface SourceView {
  id: string;
  title: string;
  version: number;
  contentSha256: string;
  text: string;
  selectedChunkId: string | null;
}
export interface ConversationView {
  id: string;
  title: string;
  updatedAt: string;
}
export type TurnStatus =
  | 'PENDING'
  | 'ANSWERED'
  | 'INSUFFICIENT_KNOWLEDGE'
  | 'ACCESS_CHANGED'
  | 'CANCELLED'
  | 'PROVIDER_ERROR'
  | 'BUDGET_EXHAUSTED'
  | 'UNVERIFIED_RESPONSE';
export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: TurnStatus | 'ACCESS_REVOKED';
  createdAt: string;
  sources: SourceCitation[];
}
export interface TurnReply {
  turnId: string;
  status: TurnStatus;
  answer: string | null;
  sources: SourceCitation[];
  model: { mode: ModelMode; id: string | null; version: string | null };
  requestId: string;
  usage?: { calls: number; inputTokens: number | null; outputTokens: number | null };
}
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
}
