import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, provenanceSchema } from './report.js';

export const liveRecordSchema = z
  .object({
    id: z.string().regex(/^L\d{2}$/),
    status: z.enum(['PASS', 'FAIL', 'ERROR', 'INCOMPLETE']),
    actualStatus: z
      .string()
      .regex(/^[A-Z_]{1,40}$/)
      .nullable(),
    modelId: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,150}$/)
      .nullable(),
    modelVersion: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,150}$/)
      .nullable(),
    checks: z
      .object({
        expectedState: z.boolean(),
        expectedConcepts: z.boolean(),
        expectedSource: z.boolean(),
        noRestrictedMarkers: z.boolean(),
        observedLiveModel: z.boolean(),
      })
      .strict(),
    generationRequests: z.number().int().min(0).max(12),
    answerSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    observations: z
      .array(
        z
          .object({
            httpStatus: z.number().int().min(100).max(599),
            modelVersion: z
              .string()
              .regex(/^[a-zA-Z0-9_.-]{1,150}$/)
              .nullable(),
            inputTokens: z.number().int().nonnegative().nullable(),
            outputTokens: z.number().int().nonnegative().nullable(),
            providerErrorCode: z
              .enum([
                'INVALID_ARGUMENT',
                'UNAUTHENTICATED',
                'PERMISSION_DENIED',
                'RESOURCE_EXHAUSTED',
                'NOT_FOUND',
                'INTERNAL',
                'UNAVAILABLE',
                'DEADLINE_EXCEEDED',
              ])
              .nullable(),
          })
          .strict(),
      )
      .max(12),
    errorCode: z
      .enum([
        'PROVIDER_UNAVAILABLE',
        'BUDGET_EXHAUSTED',
        'LIVE_ALLOWANCE_RESERVED',
        'SCENARIO_ERROR',
        'UNVERIFIED_RESPONSE',
        'ACCESS_CHANGED',
      ])
      .nullable(),
  })
  .strict();
export type LiveRecord = z.infer<typeof liveRecordSchema>;

/** Gemini evidence has a separate format and never borrows a deterministic PASS. */
export function writeLiveReport(
  root: string,
  input: {
    scope: 'smoke' | 'frozen-suite';
    provenance: unknown;
    budgetBefore: number;
    budgetAfter: number;
    records: LiveRecord[];
  },
) {
  const admitted = z
    .object({
      scope: z.enum(['smoke', 'frozen-suite']),
      provenance: provenanceSchema,
      budgetBefore: z.number().int().min(0).max(12),
      budgetAfter: z.number().int().min(0).max(12),
      records: z.array(liveRecordSchema).max(5),
    })
    .strict()
    .parse(input);
  if (
    admitted.budgetAfter < admitted.budgetBefore ||
    admitted.budgetAfter - admitted.budgetBefore !==
      admitted.records.reduce((total, item) => total + item.generationRequests, 0)
  )
    throw new Error('LIVE_BUDGET_MISMATCH');
  const records = z.array(liveRecordSchema).parse(input.records);
  const frozen = JSON.parse(readFileSync(join(root, 'verification/live-cases.json'), 'utf8')) as {
    id: string;
    question: string;
    purpose: string;
  }[];
  const expected = input.scope === 'smoke' ? frozen.slice(0, 1) : frozen;
  if (
    new Set(records.map((record) => record.id)).size !== records.length ||
    records.some((record) => !expected.some((item) => item.id === record.id))
  )
    throw new Error('LIVE_REPORT_INVALID');
  if (
    records.some(
      (record) =>
        record.status === 'PASS' &&
        (!Object.values(record.checks).every(Boolean) ||
          record.generationRequests < 1 ||
          record.modelId !== 'gemini-3.5-flash-lite' ||
          !record.modelVersion?.startsWith('gemini-3.5-flash-lite') ||
          !record.observations.some(
            (value) =>
              value.httpStatus === 200 &&
              value.providerErrorCode === null &&
              value.modelVersion === record.modelVersion,
          )),
    )
  )
    throw new Error('LIVE_REPORT_INVALID');
  const status = records.some((item) => item.status === 'ERROR')
    ? 'ERROR'
    : records.some((item) => item.status === 'FAIL')
      ? 'FAIL'
      : records.length !== expected.length || records.some((item) => item.status === 'INCOMPLETE')
        ? 'INCOMPLETE'
        : 'PASS';
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    product: 'ClearDesk',
    kind: 'live-gemini',
    scope: input.scope,
    generatedAt,
    status,
    provenance: admitted.provenance,
    frozenCasesSha256: createHash('sha256')
      .update(readFileSync(join(root, 'verification/live-cases.json')))
      .digest('hex'),
    budget: {
      before: input.budgetBefore,
      after: input.budgetAfter,
      limit: 12,
      retriesCounted: true,
    },
    cases: expected.map((item) => ({
      ...item,
      observation: records.find((record) => record.id === item.id) ?? null,
    })),
    limitations: [
      'Small fixed synthetic evaluation, not a statistical reliability claim.',
      'Concept checks are explicit regular expressions, not an independent expert semantic review.',
      'Citation and permission gates run in the application. A sourced answer can still be misinterpreted.',
      'Provider failures and missing cases remain ERROR or INCOMPLETE. No fixture substitutes for a Gemini response.',
    ],
  };
  const directory = join(
    root,
    'artifacts/runs/live',
    generatedAt.replaceAll(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8),
  );
  mkdirSync(directory, { recursive: true });
  const markdown = `# ClearDesk live Gemini evaluation\n\n${generatedAt} · **${status}** · ${input.scope}\n\nModel: gemini-3.5-flash-lite. Generation attempts: ${input.budgetAfter - input.budgetBefore}; persistent cap ${input.budgetAfter}/12 spent.\n\n| Case | Purpose | Observed | Model version |\n|---|---|---|---|\n${report.cases.map((item) => `| ${item.id} | ${item.purpose} | ${item.observation?.status ?? 'INCOMPLETE'} | ${item.observation?.modelVersion ?? 'unavailable'} |`).join('\n')}\n\n${report.limitations.map((item) => '- ' + item).join('\n')}\n`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ClearDesk · Live Gemini evidence</title><style>body{font:15px/1.7 system-ui;background:#f5f8ef;color:#284331;max-width:1000px;margin:50px auto;padding:25px}h1{font-size:40px;font-weight:500}pre{white-space:pre-wrap;word-break:break-word;background:#fff;padding:22px;border:1px solid #dce5d4;border-radius:8px;font-size:12px}</style><h1>Actual model. Explicit observations.</h1><p>Live Gemini evaluation · ${status} · ${input.scope}</p><p>Attempts remain counted, including unsuccessful dispatches. This report contains no raw prompts beyond the fixed public questions, source documents or credentials.</p><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></html>`;
  const outputs = {
    'report.json': JSON.stringify(report, null, 2) + '\n',
    'report.md': markdown,
    'report.html': html,
  };
  for (const [name, content] of Object.entries(outputs))
    writeFileSync(join(directory, name), content);
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    Object.entries(outputs)
      .map(([name, content]) => createHash('sha256').update(content).digest('hex') + '  ' + name)
      .join('\n') + '\n',
  );
  return { status, directory, generatedAt };
}
