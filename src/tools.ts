/**
 * NovaMind's RAG, exposed to the agents as an in-process MCP server.
 *
 * "In-process" matters: `createSdkMcpServer` runs the handlers as ordinary async functions in
 * this Node process. There is no subprocess, no socket, no JSON-RPC over stdio, no second copy
 * of the corpus. The existing retrieval service is called exactly the way it is called today,
 * with the same connection pool and the same credentials.
 *
 * The session also records every chunkId the tools hand out. That ledger is what makes the
 * citation lineage gate in `pipeline.ts` deterministic rather than a judgement call.
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ExtraTool, Passage, RetrievalPort } from './ports.js'

export const SERVER_NAME = 'corpus'
export const SEARCH_TOOL = `mcp__${SERVER_NAME}__search_literature`
export const PASSAGES_TOOL = `mcp__${SERVER_NAME}__get_passages`

/** What the model sees. `text` last so ids stay legible when a long passage is truncated upstream. */
function forModel(passage: Passage) {
  return {
    chunk_id: passage.chunkId,
    document_id: passage.documentId,
    title: passage.title,
    section: passage.section ?? 'Body',
    year: passage.year ?? '',
    text: passage.text,
  }
}

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

/**
 * Per-run state. Construct one per research run — never share across runs, or one run's
 * retrievals would ground another run's citations.
 */
export class CorpusSession {
  readonly server: McpSdkServerConfigWithInstance
  /** Every chunkId any tool returned this run. The lineage gate's allowlist. */
  readonly seenIds = new Set<string>()

  constructor(
    private readonly port: RetrievalPort,
    private readonly maxTopK: number,
    extraTools: ExtraTool[] = [],
  ) {
    this.server = createSdkMcpServer({
      name: SERVER_NAME,
      version: '1.0.0',
      tools: [this.searchTool(), this.passagesTool(), ...extraTools],
    })
  }

  private record(passages: Passage[]): Passage[] {
    for (const passage of passages) this.seenIds.add(passage.chunkId)
    return passages
  }

  private searchTool() {
    return tool(
      'search_literature',
      'Hybrid semantic and lexical search over the corpus. Returns passages with their chunk_id, ' +
        'document_id, title, section and text. The chunk_id is how later stages read the passage ' +
        'again, so copy it exactly.',
      {
        query: z.string().describe('A focused search query. One facet per call.'),
        top_k: z.number().int().min(1).optional().describe('Passages to return. Default 8.'),
      },
      async (args) => {
        const topK = Math.max(1, Math.min(args.top_k ?? 8, this.maxTopK))
        try {
          const passages = this.record(await this.port.search(args.query, topK))
          return ok({ passages: passages.map(forModel) })
        } catch (error) {
          // Returned as a tool error, not thrown: the agent sees the failure, can retry a
          // narrower query, and the stream records it for the tools_succeeded gate.
          return err(`search failed: ${(error as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true, openWorldHint: false } },
    )
  }

  private passagesTool() {
    return tool(
      'get_passages',
      'Fetch the full text of specific passages by the chunk_ids search_literature returned. ' +
        'Use before reasoning about a passage you have only seen a snippet of.',
      { chunk_ids: z.array(z.string()).min(1).describe('Exact chunk_ids, copied from tool output.') },
      async (args) => {
        try {
          const passages = this.record(await this.port.fetch(args.chunk_ids))
          const missing = args.chunk_ids.filter((id) => !passages.some((p) => p.chunkId === id))
          // Naming the misses tells the model its id was wrong, instead of letting it read an
          // empty result as "this passage says nothing".
          return ok({
            passages: passages.map(forModel),
            ...(missing.length ? { not_found: missing } : {}),
          })
        } catch (error) {
          return err(`fetch failed: ${(error as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true, openWorldHint: false } },
    )
  }
}
