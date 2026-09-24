/**
 * npm run demo -- "your question"
 *
 * Runs the provider against the bundled synthetic corpus. No database, no embeddings, no RAG
 * service. Everything printed below comes from the RunRecord, which is the same object a
 * production deployment would send to LangSmith and Braintrust.
 */

import { createClaudeResearchProvider, InMemoryCorpus, type RunRecord } from '../src/index.js'

const QUESTION =
  process.argv.slice(2).join(' ') ||
  'What mechanisms of resistance emerge after targeted protein degradation, and how could they be overcome?'

function usd(n: number) {
  return `$${n.toFixed(4)}`
}

function report(record: RunRecord) {
  const { gates, lineage } = record
  console.log('')
  console.log(`  ${record.wallMs / 1000}s · ${usd(record.costUsd)} · ttft ${record.ttftMs ?? '—'}ms`)
  for (const stage of record.stages) {
    const searches = stage.toolCalls.filter((c) => c.name === 'search_literature').length
    const agents = new Set(stage.toolCalls.map((c) => c.agent).filter(Boolean)).size
    console.log(
      `    ${stage.name.padEnd(11)} ${stage.model.padEnd(17)} ${(stage.wallMs / 1000).toFixed(1)}s  ` +
        `${usd(stage.costUsd)}  ${stage.toolCalls.length} tool calls` +
        (agents ? ` across ${agents} subagents` : '') +
        (searches ? ` · ${searches} searches` : ''),
    )
  }

  console.log('')
  console.log('  gates')
  console.log(`    structured_output_valid  ${gates.structuredOutputValid}`)
  console.log(`    citation_lineage_valid   ${gates.citationLineageValid}`)
  console.log(`    tools_succeeded          ${gates.toolsSucceeded}`)
  console.log(`    citations ${lineage.grounded}/${lineage.cited} traced to a tool call in this run`)
  if (lineage.fabricated.length) {
    console.log(`    REJECTED ids: ${lineage.fabricated.join(', ')}`)
  }
  if (lineage.droppedClaims.length) {
    console.log(`    dropped claims: ${lineage.droppedClaims.length}`)
    for (const claim of lineage.droppedClaims) console.log(`      - ${claim}`)
  }

  if (record.error) {
    console.error(`\n  error: ${record.error}`)
    return
  }
  const result = record.report
  if (!result) return

  console.log(`\n  ${result.synthesis}\n`)
  console.log(`  findings (${result.findings.length})`)
  for (const finding of result.findings) {
    console.log(`    [${finding.confidence}] ${finding.claim}`)
    // Every line below is written from corpus metadata, never from model output.
    for (const citation of finding.citations) {
      console.log(`         ${citation.chunkId}  ${citation.title.slice(0, 68)}`)
    }
  }

  if (result.hypotheses.length) {
    console.log(`\n  hypotheses (${result.hypotheses.length})`)
    for (const hypothesis of result.hypotheses) {
      console.log(`    [${hypothesis.confidence}] ${hypothesis.title}`)
      console.log(`         ${hypothesis.statement}`)
      console.log(`         predicts: ${hypothesis.testablePrediction}`)
      console.log(`         test:     ${hypothesis.suggestedExperiment}`)
    }
  }

  if (result.limitations.length) {
    console.log(`\n  limitations`)
    for (const limitation of result.limitations) console.log(`    - ${limitation}`)
  }
}

async function main() {
  const corpus = new InMemoryCorpus()
  const provider = createClaudeResearchProvider(corpus, {
    // Each run record would go to LangSmith/Braintrust in production. Here: a one-line heartbeat.
    onRunRecord: (record) => console.log(`\n  [${record.runId}] ${record.status}`),
  })

  console.log(`\n  ${QUESTION}`)
  console.log(`  ${corpus.size} synthetic passages · provider "${provider.name}"`)

  const record = await provider.research({ question: QUESTION })
  report(record)
  process.exit(record.status === 'complete' && record.gates.citationLineageValid === 1 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
