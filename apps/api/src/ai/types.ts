import type { ModelAnswer, ModelMode } from '@cleardesk/contracts';

export interface SourceChunk {
  documentId: string;
  chunkId: string;
  title: string;
  text: string;
  contentSha256: string;
  version: number;
  similarity: number;
}
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface ScopedTools {
  search(input: unknown): Promise<SourceChunk[]>;
  read(input: unknown): Promise<SourceChunk[]>;
  registry: Map<string, SourceChunk>;
}
export interface ModelRun {
  question: string;
  history: HistoryMessage[];
  chunks: SourceChunk[];
  tools: ScopedTools;
  signal: AbortSignal;
}
export interface ModelResult {
  output: unknown;
  model: { mode: ModelMode; id: string | null; version: string | null };
  usage?: { calls: number; inputTokens: number | null; outputTokens: number | null };
}
export interface ModelRunner {
  run(input: ModelRun): Promise<ModelResult>;
}
export type VerifiedAnswer = ModelAnswer;
