/**
 * One canonical record per run, emitted whether the run succeeded or failed.
 *
 * Shaped so the same object can be written to LangSmith as a trace, to Braintrust as an
 * experiment row, and to NovaMind's own store — without any of the three being the source of
 * truth for the other two. `runtime` is an application-owned field, so a head-to-head comparison
 * against the OpenAI agent is a `GROUP BY` rather than a second pipeline.
 */

import type { ResearchReport } from './contract.js'

export type ToolCall = {
  /** `search_literature` or `get_passages`, plus any extra tools supplied. */
  name: string
  /** Which subagent made the call. Null for the lead's own calls. */
  agent: string | null
  durationMs: number
  ok: boolean
  /** chunkIds this call returned. The raw material of the lineage gate. */
  returnedChunkIds: string[]
}

export type StageRecord = {
  name: 'literature' | 'hypotheses'
  model: string
  wallMs: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  /** True when the SDK returned structured output that parsed against the stage schema first try. */
  structuredOutputValid: boolean
  toolCalls: ToolCall[]
}

/** Deterministic reliability gates. Each is 0 or 1, no partial credit. */
export type Gates = {
  /** Raw final output parsed against the contract with no application-side repair. */
  structuredOutputValid: 0 | 1
  /** Every cited chunkId was returned by a tool in *this* run and resolves in the corpus. */
  citationLineageValid: 0 | 1
  /** Required stages ran and every tool call completed without error. */
  toolsSucceeded: 0 | 1
}

export type Lineage = {
  /** Distinct chunkIds the model cited. */
  cited: number
  /** Of those, how many a tool actually returned this run. */
  grounded: number
  /** Ids no tool returned. Fabricated. Removed before the report is assembled. */
  fabricated: string[]
  /** Claims dropped because every id they cited was fabricated. */
  droppedClaims: string[]
}

export type RunRecord = {
  runId: string
  runtime: string
  question: string
  status: 'complete' | 'failed'
  startedAt: string
  wallMs: number
  /** Time from run start to the first assistant text of stage 1. */
  ttftMs: number | null
  costUsd: number
  gates: Gates
  lineage: Lineage
  stages: StageRecord[]
  report: ResearchReport | null
  error: string | null
}

export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Sum of a field across stages. Stage costs are per-`query()` call, so summing is correct. */
export function totalCost(stages: StageRecord[]): number {
  return stages.reduce((sum, stage) => sum + stage.costUsd, 0)
}
