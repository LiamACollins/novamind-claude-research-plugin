/**
 * The two-stage run, and the gate that makes its citations trustworthy.
 *
 * The citation lineage gate is the part worth reading. Every chunkId the model cites is checked
 * against the set of chunkIds the retrieval tools actually returned *during this run*. An id the
 * tools never handed out cannot have been read, so a claim resting on it is unsupported by
 * construction — regardless of how well-formed, plausible, or confidently stated it is. Those
 * claims are removed and reported, not quietly kept.
 *
 * Then the surviving ids are re-fetched from the corpus and the human-readable citation fields
 * are written from that trusted metadata. The model never authors a title, a document id or a
 * URL. It can only select from what it was given.
 */

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { z } from 'zod'
import { hypothesisOptions, literatureOptions } from './agents.js'
import {
  hypothesisStageSchema,
  literatureStageSchema,
  researchReportSchema,
  type Citation,
  type Finding,
  type Hypothesis,
  type LiteratureStage,
  type ResearchReport,
} from './contract.js'
import type { RetrievalPort } from './ports.js'
import type { ClaudeResearchSettings } from './settings.js'
import { CorpusSession } from './tools.js'
import { newRunId, totalCost, type Gates, type Lineage, type RunRecord, type StageRecord, type ToolCall } from './telemetry.js'

export class StageError extends Error {}

type StageResult<T> = { value: T; record: StageRecord; ttftMs: number | null }

type OpenCall = { name: string; agent: string | null; startedAt: number }

const AGENT_TOOLS = new Set(['Agent', 'Task'])

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
    .join('')
}

/**
 * Run one stage to completion and validate its output against the stage schema.
 *
 * The SDK has already constrained generation to the schema and retried non-conforming turns
 * inside the agent loop. This parse is the independent check on the raw final output, before any
 * application-side repair, defaulting or coercion — so `structuredOutputValid` measures the
 * runtime rather than measuring our own clean-up code.
 */
async function runStage<S extends z.ZodType>(
  name: StageRecord['name'],
  prompt: string,
  options: Options,
  schema: S,
  model: string,
): Promise<StageResult<z.infer<S>>> {
  const started = Date.now()
  const open = new Map<string, OpenCall>()
  const agents = new Map<string, string>()
  const toolCalls: ToolCall[] = []
  let ttftMs: number | null = null
  let result: Extract<SDKMessage, { type: 'result' }> | null = null

  for await (const message of query({ prompt, options })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content as Array<Record<string, any>>) {
        if (block.type === 'text' && ttftMs === null && String(block.text).trim()) {
          ttftMs = Date.now() - started
        }
        if (block.type !== 'tool_use') continue
        if (AGENT_TOOLS.has(block.name)) {
          // Number the searchers so parallel subagents stay distinguishable in the record.
          agents.set(block.id, `${block.input?.subagent_type ?? 'subagent'}-${agents.size + 1}`)
        } else {
          open.set(block.id, {
            name: String(block.name).split('__').pop() ?? String(block.name),
            // `parent_tool_use_id` is the only place the stream says *which* agent made a call;
            // a tool handler sees nothing but its own arguments.
            agent: agents.get(message.parent_tool_use_id ?? '') ?? null,
            startedAt: Date.now(),
          })
        }
      }
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content as Array<Record<string, any>>) {
        if (block.type !== 'tool_result') continue
        const call = open.get(block.tool_use_id)
        if (!call) continue // the Agent tool's own result; subagent spans close with the stage
        open.delete(block.tool_use_id)
        let returnedChunkIds: string[] = []
        try {
          const payload = JSON.parse(textOf(block.content)) as { passages?: Array<{ chunk_id: string }> }
          returnedChunkIds = (payload.passages ?? []).map((p) => p.chunk_id)
        } catch {
          // A tool error returns plain text, not JSON. `ok` below already records that.
        }
        toolCalls.push({
          name: call.name,
          agent: call.agent,
          durationMs: Date.now() - call.startedAt,
          ok: block.is_error !== true,
          returnedChunkIds,
        })
      }
    } else if (message.type === 'result') {
      result = message
    }
  }

  const usage = result?.modelUsage ?? {}
  const record: StageRecord = {
    name,
    model,
    wallMs: Date.now() - started,
    costUsd: result?.total_cost_usd ?? 0,
    inputTokens: Object.values(usage).reduce((sum, u) => sum + (u.inputTokens ?? 0), 0),
    outputTokens: Object.values(usage).reduce((sum, u) => sum + (u.outputTokens ?? 0), 0),
    structuredOutputValid: false,
    toolCalls,
  }

  if (!result || result.subtype !== 'success' || result.structured_output === undefined) {
    const detail =
      result && 'errors' in result && result.errors?.length ? result.errors.join('; ') : result?.subtype ?? 'no result'
    throw Object.assign(new StageError(`${name}: ${detail}`), { record })
  }

  const parsed = schema.safeParse(result.structured_output)
  if (!parsed.success) {
    throw Object.assign(new StageError(`${name}: schema validation failed: ${parsed.error.message}`), { record })
  }
  record.structuredOutputValid = true
  return { value: parsed.data, record, ttftMs }
}

/** Two claims are the same when their text matches or they rest on exactly the same passages. */
export function dedupe(findings: LiteratureStage['findings']): LiteratureStage['findings'] {
  const seenText = new Set<string>()
  const seenEvidence = new Set<string>()
  const kept: LiteratureStage['findings'] = []
  for (const finding of findings) {
    const text = finding.claim.toLowerCase().split(/\s+/).join(' ')
    const evidence = [...new Set(finding.chunkIds)].sort().join('|')
    if (seenText.has(text) || seenEvidence.has(evidence)) continue
    seenText.add(text)
    seenEvidence.add(evidence)
    kept.push(finding)
  }
  return kept
}

/**
 * The gate. Drop every chunkId no tool returned this run, and every claim left with no evidence.
 *
 * Run before the hypothesis stage, for two reasons. A fabricated id resolves to nothing, so
 * forwarding it wastes a call and leaves stage 2 believing it has evidence it never read. And a
 * claim whose every id was invented has no evidence at all, so it must not reach the report.
 * Fabricated ids are reported rather than hidden: a silent filter would make the failure
 * invisible in exactly the eval that should catch it.
 */
export function applyLineageGate(
  findings: LiteratureStage['findings'],
  seenIds: ReadonlySet<string>,
): { kept: LiteratureStage['findings']; lineage: Lineage } {
  const cited = new Set(findings.flatMap((f) => f.chunkIds))
  const fabricated = [...cited].filter((id) => !seenIds.has(id)).sort()
  const fabricatedSet = new Set(fabricated)

  const kept: LiteratureStage['findings'] = []
  const droppedClaims: string[] = []
  for (const finding of findings) {
    const real = finding.chunkIds.filter((id) => !fabricatedSet.has(id))
    if (real.length) kept.push({ ...finding, chunkIds: real })
    else droppedClaims.push(finding.claim)
  }

  return {
    kept,
    lineage: { cited: cited.size, grounded: cited.size - fabricated.length, fabricated, droppedClaims },
  }
}

/** Human-readable citation fields, written from the corpus rather than from model output. */
async function rehydrate(
  findings: LiteratureStage['findings'],
  port: RetrievalPort,
): Promise<{ findings: Finding[]; unresolved: string[] }> {
  const ids = [...new Set(findings.flatMap((f) => f.chunkIds))]
  const passages = await port.fetch(ids)
  const byId = new Map(passages.map((p) => [p.chunkId, p]))
  const unresolved = ids.filter((id) => !byId.has(id))

  const out: Finding[] = []
  for (const finding of findings) {
    const citations: Citation[] = []
    for (const id of finding.chunkIds) {
      const passage = byId.get(id)
      if (!passage) continue
      citations.push({
        chunkId: passage.chunkId,
        documentId: passage.documentId,
        title: passage.title,
        ...(passage.url ? { url: passage.url } : {}),
      })
    }
    if (citations.length) out.push({ claim: finding.claim, citations, confidence: finding.confidence })
  }
  return { findings: out, unresolved }
}

export async function runResearch(
  question: string,
  port: RetrievalPort,
  settings: ClaudeResearchSettings,
  runtime = 'claude-agent-sdk',
): Promise<RunRecord> {
  const runId = newRunId()
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const session = new CorpusSession(port, settings.maxTopK, settings.extraTools)
  const stages: StageRecord[] = []

  let report: ResearchReport | null = null
  let lineage: Lineage = { cited: 0, grounded: 0, fabricated: [], droppedClaims: [] }
  let ttftMs: number | null = null
  let error: string | null = null
  let structuredOutputValid = false
  let citationLineageValid = false

  try {
    const stage1 = await runStage(
      'literature',
      question,
      literatureOptions(session, settings),
      literatureStageSchema,
      settings.models.lead,
    )
    stages.push(stage1.record)
    ttftMs = stage1.ttftMs

    const gated = applyLineageGate(dedupe(stage1.value.findings), session.seenIds)
    lineage = gated.lineage
    if (!gated.kept.length) {
      throw new StageError('literature: every claim cited passages that were never retrieved')
    }

    const { findings, unresolved } = await rehydrate(gated.kept, port)
    if (!findings.length) throw new StageError('literature: no cited passage resolved in the corpus')
    // Seen this run but no longer resolvable: a corpus mutation mid-run. Rare, but it breaks the
    // same guarantee a fabricated id breaks, so it fails the same gate.
    citationLineageValid = lineage.fabricated.length === 0 && unresolved.length === 0
    lineage.fabricated = [...lineage.fabricated, ...unresolved].sort()

    let hypotheses: Hypothesis[] = []
    let caveats: string[] = []
    if (settings.stages.hypotheses) {
      // Built here, in TypeScript. Nothing in this prompt passed through a model, so the ids
      // arrive at stage 2 exactly as the tools produced them.
      const prompt =
        `Research question: ${question}\n\n` +
        `Literature findings. The chunk_ids are valid — read them with get_passages:\n` +
        JSON.stringify({ findings: gated.kept, gaps: stage1.value.gaps }, null, 2)
      const stage2 = await runStage(
        'hypotheses',
        prompt,
        hypothesisOptions(session, settings),
        hypothesisStageSchema,
        settings.models.hypothesis,
      )
      stages.push(stage2.record)
      hypotheses = stage2.value.hypotheses
      caveats = stage2.value.caveats
    }

    const candidate: ResearchReport = {
      question,
      synthesis: stage1.value.synthesis,
      findings,
      hypotheses,
      limitations: [...stage1.value.gaps, ...caveats],
    }
    report = researchReportSchema.parse(candidate)
    structuredOutputValid = stages.every((s) => s.structuredOutputValid)
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
    const partial = (thrown as { record?: StageRecord }).record
    if (partial) stages.push(partial)
  }

  const requiredStages = settings.stages.hypotheses ? 2 : 1
  const gates: Gates = {
    structuredOutputValid: structuredOutputValid ? 1 : 0,
    citationLineageValid: citationLineageValid && report !== null ? 1 : 0,
    toolsSucceeded:
      stages.length === requiredStages && stages.every((s) => s.toolCalls.every((c) => c.ok)) ? 1 : 0,
  }

  const record: RunRecord = {
    runId,
    runtime,
    question,
    status: report ? 'complete' : 'failed',
    startedAt,
    wallMs: Date.now() - started,
    ttftMs,
    costUsd: totalCost(stages),
    gates,
    lineage,
    stages,
    report,
    error,
  }
  settings.onRunRecord?.(record)
  return record
}
