/**
 * @novamind/claude-research — a Claude Agent SDK research provider that runs beside the
 * existing OpenAI research agent, over the RAG NovaMind already has.
 *
 * Integrating it is three steps:
 *
 *   1. Implement `RetrievalPort` over the existing search service. Two methods.
 *   2. `createClaudeResearchProvider(port)`.
 *   3. Put it behind `createRouter` in `shadow` mode and read the run records.
 *
 * No corpus is re-vectorised, no prompt pipeline is rewritten, and the OpenAI path is untouched.
 */

export type { Passage, RetrievalPort, ExtraTool } from './ports.js'
export {
  researchReportSchema,
  literatureStageSchema,
  hypothesisStageSchema,
  toJsonSchema,
  type ResearchReport,
  type Finding,
  type Hypothesis,
  type Citation,
  type Confidence,
} from './contract.js'
export {
  loadSettings,
  DEFAULT_SETTINGS,
  type ClaudeResearchSettings,
  type StageModels,
  type Effort,
} from './settings.js'
export type { RunRecord, StageRecord, ToolCall, Gates, Lineage } from './telemetry.js'
export {
  createClaudeResearchProvider,
  createRouter,
  type ResearchProvider,
  type ResearchRequest,
  type RouterConfig,
  type RolloutMode,
} from './provider.js'
export { runResearch, applyLineageGate, dedupe, StageError } from './pipeline.js'
export { CorpusSession, SEARCH_TOOL, PASSAGES_TOOL, SERVER_NAME } from './tools.js'
export { InMemoryCorpus } from './adapters/memory-corpus.js'
