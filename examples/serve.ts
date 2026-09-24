/**
 * npm run serve  ->  POST http://localhost:8787/research {"question": "..."}
 *
 * The parallel-service shape: the Claude provider behind a router, deployable next to the
 * existing research service rather than inside it. In a real deployment `primary` is NovaMind's
 * OpenAI research agent wrapped as a `ResearchProvider` (see docs/INTEGRATION.md); here it is a
 * stub, so the example runs standalone.
 *
 *   CLAUDE_RESEARCH_MODE=shadow  customers get the incumbent answer, Claude runs and is recorded
 *   CLAUDE_RESEARCH_MODE=split   CLAUDE_RESEARCH_SPLIT_PERCENT=10
 *   CLAUDE_RESEARCH_MODE=on      Claude answers
 */

import { createServer } from 'node:http'
import {
  createClaudeResearchProvider,
  createRouter,
  InMemoryCorpus,
  type ResearchProvider,
  type RunRecord,
} from '../src/index.js'

const PORT = Number(process.env.PORT ?? 8787)

/** Stand-in for the existing OpenAI research agent. Replace with the real wrapper. */
const incumbent: ResearchProvider = {
  name: 'openai-agents-sdk',
  research: async ({ question }) => {
    throw new Error(`no incumbent provider wired in this example (question: ${question.slice(0, 40)}...)`)
  },
}

const records: RunRecord[] = []

const claude = createClaudeResearchProvider(new InMemoryCorpus(), {
  // One sink, every runtime. `runtime` on the record is what a comparison groups by.
  onRunRecord: (record) => {
    records.push(record)
    console.log(
      `[${record.runtime}] ${record.status} ${record.wallMs}ms $${record.costUsd.toFixed(4)} ` +
        `gates=${Object.values(record.gates).join('')} citations=${record.lineage.grounded}/${record.lineage.cited}`,
    )
  },
})

const router = createRouter({
  primary: incumbent,
  candidate: claude,
  mode: (process.env.CLAUDE_RESEARCH_MODE as never) ?? 'on',
  onShadowError: (error) => console.error('[shadow] suppressed:', (error as Error).message),
})

createServer(async (request, response) => {
  const json = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body, null, 2))
  }

  if (request.method === 'GET' && request.url === '/runs') return json(200, records)
  if (request.method !== 'POST' || request.url !== '/research') return json(404, { error: 'not found' })

  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)

  try {
    const { question } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    if (typeof question !== 'string' || !question.trim()) {
      return json(400, { error: 'body must be {"question": "..."}' })
    }
    const record = await router.research({ question })
    // 200 on a failed run too: the RunRecord carries the failure, and a caller comparing two
    // runtimes needs the record either way.
    json(200, record)
  } catch (error) {
    json(500, { error: (error as Error).message })
  }
}).listen(PORT, () => {
  console.log(`  research service on :${PORT} · router "${router.name}"`)
  console.log(`  curl -s localhost:${PORT}/research -d '{"question":"What drives degrader resistance?"}'`)
})
