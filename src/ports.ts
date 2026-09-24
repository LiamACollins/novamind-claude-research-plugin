/**
 * The only interface NovaMind implements.
 *
 * Both methods almost certainly already exist inside the current RAG service: one
 * semantic/hybrid search, one fetch-by-id. Nothing is re-vectorised, no corpus moves, and the
 * OpenAI research agent keeps calling the same functions it calls today.
 */

import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'

/**
 * One retrieved passage.
 *
 * `chunkId` is the citation key and the security boundary. It is opaque to the model: the model
 * may only ever *copy* one back, never compose one. Everything a human reads in the final report
 * — title, document id, URL — is re-derived from this object after the run, never from model
 * output. See `docs/CITATIONS.md`.
 */
export type Passage = {
  /** Stable id of this chunk in NovaMind's corpus. Must round-trip through `fetch`. */
  chunkId: string
  /** PMID, PMCID, DOI — whatever NovaMind keys documents on. */
  documentId: string
  title: string
  /** e.g. "Results > Resistance". Helps the model weigh a passage; optional. */
  section?: string
  /** Publication year, as a string. Optional. */
  year?: string
  text: string
  url?: string
}

export interface RetrievalPort {
  /** Hybrid/semantic search. Return at most `topK` passages, best first. */
  search(query: string, topK: number): Promise<Passage[]>
  /** Resolve exact chunk ids. Unknown ids are omitted, never invented. */
  fetch(chunkIds: string[]): Promise<Passage[]>
}

/**
 * Escape hatch for the tools NovaMind already gives its research agent that are not retrieval —
 * the data-analysis agent's validation against client experimental data, for instance.
 *
 * Build them with the SDK's `tool()` helper and they are exposed to the research subagent
 * alongside search/fetch, with no change to this package.
 */
export type ExtraTool = SdkMcpToolDefinition<any>
