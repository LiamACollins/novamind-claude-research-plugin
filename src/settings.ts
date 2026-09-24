/**
 * Configuration, deliberately namespaced.
 *
 * Every environment variable is `CLAUDE_RESEARCH_*`, plus `ANTHROPIC_API_KEY`. Nothing here
 * reads, writes, or collides with `OPENAI_*`. The Claude provider can therefore be configured,
 * budgeted, rolled out and rolled back without touching the configuration of the agent already
 * in production.
 */

import type { ExtraTool } from './ports.js'
import type { RunRecord } from './telemetry.js'

export type StageModels = {
  /** Splits the question into facets and merges the results. Cheap; does no reading. */
  lead: string
  /** Runs the searches and reads the passages. One instance per facet, in parallel. */
  searcher: string
  /** Reads the cited primary text and proposes hypotheses. The expensive, high-value stage. */
  hypothesis: string
}

export type ClaudeResearchSettings = {
  models: StageModels
  effort: { lead: Effort; searcher: Effort; hypothesis: Effort }
  /** Parallel search subagents. 1 disables fan-out and runs a single searcher. */
  researchers: number
  /** Hard cap on findings per searcher. Output tokens dominate latency; this is the main lever. */
  maxFindingsPerResearcher: number
  maxHypotheses: number
  /** Largest `topK` a searcher may request. */
  maxTopK: number
  /** Per-run spend ceiling, enforced by the SDK. A run that exceeds it fails rather than bills. */
  maxBudgetUsd: number
  stages: { hypotheses: boolean }
  /** Extra non-retrieval tools to expose to the searcher (e.g. experimental-data validation). */
  extraTools: ExtraTool[]
  /** Called once per run, success or failure. Pipe to LangSmith, Braintrust, or a log. */
  onRunRecord?: (record: RunRecord) => void
  /** Overrides `ANTHROPIC_API_KEY` for this provider only. */
  apiKey?: string
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const DEFAULT_SETTINGS: ClaudeResearchSettings = {
  models: {
    // The lead only routes and merges, so it does not need the frontier model. Move it to
    // 'claude-opus-5' if merge fidelity across many facets matters more than cost.
    lead: 'claude-sonnet-5',
    searcher: 'claude-sonnet-5',
    hypothesis: 'claude-opus-5',
  },
  effort: { lead: 'low', searcher: 'medium', hypothesis: 'high' },
  researchers: 3,
  maxFindingsPerResearcher: 5,
  maxHypotheses: 3,
  maxTopK: 20,
  maxBudgetUsd: 5,
  stages: { hypotheses: true },
  extraTools: [],
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`)
  return parsed
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

/**
 * Defaults <- `CLAUDE_RESEARCH_*` environment <- explicit overrides.
 *
 * Overrides win, so a caller can pin settings per request (a cheap tier for interactive use, a
 * deeper one for an overnight batch) without touching process configuration.
 */
export function loadSettings(overrides: Partial<ClaudeResearchSettings> = {}): ClaudeResearchSettings {
  const base: ClaudeResearchSettings = {
    ...DEFAULT_SETTINGS,
    models: {
      lead: process.env.CLAUDE_RESEARCH_LEAD_MODEL || DEFAULT_SETTINGS.models.lead,
      searcher: process.env.CLAUDE_RESEARCH_SEARCH_MODEL || DEFAULT_SETTINGS.models.searcher,
      hypothesis: process.env.CLAUDE_RESEARCH_HYPOTHESIS_MODEL || DEFAULT_SETTINGS.models.hypothesis,
    },
    researchers: num('CLAUDE_RESEARCH_RESEARCHERS', DEFAULT_SETTINGS.researchers),
    maxFindingsPerResearcher: num(
      'CLAUDE_RESEARCH_MAX_FINDINGS',
      DEFAULT_SETTINGS.maxFindingsPerResearcher,
    ),
    maxHypotheses: num('CLAUDE_RESEARCH_MAX_HYPOTHESES', DEFAULT_SETTINGS.maxHypotheses),
    maxTopK: num('CLAUDE_RESEARCH_MAX_TOP_K', DEFAULT_SETTINGS.maxTopK),
    maxBudgetUsd: num('CLAUDE_RESEARCH_MAX_BUDGET_USD', DEFAULT_SETTINGS.maxBudgetUsd),
    stages: { hypotheses: bool('CLAUDE_RESEARCH_HYPOTHESES', DEFAULT_SETTINGS.stages.hypotheses) },
    extraTools: [],
    apiKey: process.env.ANTHROPIC_API_KEY,
  }

  const merged = { ...base, ...overrides }
  merged.models = { ...base.models, ...overrides.models }
  merged.effort = { ...base.effort, ...overrides.effort }
  merged.stages = { ...base.stages, ...overrides.stages }

  if (merged.researchers < 1) throw new Error('researchers must be >= 1')
  if (merged.maxBudgetUsd <= 0) throw new Error('maxBudgetUsd must be > 0')
  return merged
}
