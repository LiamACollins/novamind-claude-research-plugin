# Integrating by hand

Four steps. None of them touches the OpenAI path.

The automated version of this is [`../INTEGRATION_PROMPT.md`](../INTEGRATION_PROMPT.md), which is
written to be pasted into Claude Code inside your repository.

## 1. Implement `RetrievalPort`

Two methods over the retrieval service you already run.

```ts
// src/research/claude/port.ts
import type { Passage, RetrievalPort } from '@novamind/claude-research'
import { hybridSearch, getChunks } from '../../rag/service.js'

const toPassage = (row: ChunkRow): Passage => ({
  chunkId: row.id,              // must round-trip through fetch()
  documentId: row.pmid,         // PMID, PMCID, DOI — whatever you key on
  title: row.title,
  section: row.sectionPath?.join(' > '),
  year: String(row.publishedAt ?? '').slice(0, 4),
  text: row.content,
  url: row.sourceUrl,
})

export const port: RetrievalPort = {
  search: async (query, topK) => (await hybridSearch(query, { topK })).map(toPassage),
  fetch:  async (chunkIds)    => (await getChunks(chunkIds)).map(toPassage),
}
```

Two requirements, both of which your service almost certainly meets already:

- **`chunkId` round-trips.** An id from `search` must resolve through `fetch`.
- **`fetch` omits unknown ids.** Never return a placeholder row. The citation guarantee rests on
  this; see [CITATIONS.md](CITATIONS.md).

If reranking is a separate call, put it inside `search`. The agent sees one tool either way.

## 2. Wrap the existing agent as a provider

`ResearchProvider` is the seam. Your OpenAI agent becomes one by mapping its output to
`ResearchReport` — the same mapping your downstream consumers already rely on.

```ts
// src/research/providers/openai.ts
import type { ResearchProvider, RunRecord } from '@novamind/claude-research'
import { runResearchAgent } from '../openai-agent.js'

export const openaiProvider: ResearchProvider = {
  name: 'openai-agents-sdk',
  async research({ question }) {
    const started = Date.now()
    const result = await runResearchAgent(question)
    return {
      runId: crypto.randomUUID(),
      runtime: 'openai-agents-sdk',
      question,
      status: 'complete',
      startedAt: new Date(started).toISOString(),
      wallMs: Date.now() - started,
      ttftMs: null,
      costUsd: result.costUsd ?? 0,
      // Score with the *same* gate code, so the comparison is symmetric.
      gates: { structuredOutputValid: 1, citationLineageValid: 1, toolsSucceeded: 1 },
      lineage: { cited: 0, grounded: 0, fabricated: [], droppedClaims: [] },
      stages: [],
      report: result.report,
      error: null,
    } satisfies RunRecord
  },
}
```

Make the gates real before you trust a comparison. `structuredOutputValid` should be
`researchReportSchema.safeParse(rawOutput).success` on the **raw** output, before any repair, and
`citationLineageValid` should run `applyLineageGate` against the ids your OpenAI tools returned.
A comparison where only one side is graded strictly tells you nothing.

## 3. Route

```ts
// src/research/index.ts
import { createClaudeResearchProvider, createRouter } from '@novamind/claude-research'
import { port } from './claude/port.js'
import { openaiProvider } from './providers/openai.js'

const claude = createClaudeResearchProvider(port, {
  onRunRecord: (record) => {
    void braintrust.log({ input: record.question, output: record.report, scores: record.gates,
                          metadata: { runtime: record.runtime, lineage: record.lineage } })
    void langsmith.createRun({ name: 'research', inputs: { question: record.question },
                               outputs: { report: record.report }, extra: { metadata: record } })
  },
})

export const research = createRouter({
  primary: openaiProvider,
  candidate: claude,
  onShadowError: (error) => logger.warn({ error }, 'claude shadow run failed'),
})
```

Then change the call site — one line, from `runResearchAgent(question)` to
`research.research({ question })`.

## 4. Deploy in shadow

```bash
CLAUDE_RESEARCH_MODE=shadow
CLAUDE_RESEARCH_RESEARCHERS=3
CLAUDE_RESEARCH_MAX_BUDGET_USD=5
ANTHROPIC_API_KEY=...
```

Customers get the incumbent answer on every request. Claude runs alongside on the same real
questions, and its run records land in Braintrust and LangSmith. The shadow call is not awaited
and its errors are swallowed, so it cannot add latency to a customer request or fail one.

Leave it a week. Then read: gate pass rates by runtime, cost and p50/p95 latency per stage, and —
the one that matters for a research product — `lineage.grounded / lineage.cited` on each side.

Move to `split` at 5–10% when the gates hold. Roll back by setting `CLAUDE_RESEARCH_MODE=off`.

## Notes

- **Concurrency.** Each run spawns `researchers` subagents. Budget
  `concurrent requests × researchers` in-flight model calls and set
  `CLAUDE_RESEARCH_MAX_BUDGET_USD` accordingly — the SDK fails a run that exceeds it rather than
  billing through it.
- **One session per run.** `createClaudeResearchProvider` handles this. If you call `runResearch`
  directly, never reuse a `CorpusSession`: one run's retrievals would ground another run's
  citations.
- **Non-retrieval tools.** Pass existing SDK `tool()` definitions through `extraTools` — the
  data-analysis agent's experimental-data validation, for instance. They are exposed to the
  searcher alongside search and fetch.
- **Runtime.** The SDK spawns the Claude Code executable as a subprocess. In a container, install
  the package and make sure Node ≥20 is on `PATH`; `settingSources: []` is already set so no host
  configuration leaks in.
