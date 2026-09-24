# @novamind/claude-research

A Claude Agent SDK research agent that runs **beside** an existing OpenAI Agents SDK research
agent, over the RAG you already have.

It is not a migration. It is a second implementation behind one interface, wired so it can run in
shadow on production questions — answering nobody, scored on every run — until the numbers justify
sending it traffic. Rollback is an environment variable.

```bash
npm install && npm run demo
```

That runs the full two-stage pipeline against a small bundled corpus. No database, no embeddings,
no RAG service, no `OPENAI_*` anything. You need `ANTHROPIC_API_KEY`, or the Claude Code
credentials you already have.

## What it is

```
                        ┌─────────────────────────────────────────────┐
  your API route ─────► │  ResearchProvider                           │
                        │    ├─ openai-agents-sdk   (yours, wrapped)  │
                        │    └─ claude-agent-sdk    (this package)    │
                        └───────────────────┬─────────────────────────┘
                                            │
                                     RetrievalPort          ◄── the only thing you implement
                                            │                    (2 methods, ~20 lines)
                                            ▼
                             your existing RAG / pgvector / PubMed index
```

One interface, `ResearchProvider`. One port, `RetrievalPort`. Everything else — corpus, chunking,
embeddings, reranking, the OpenAI agent, your prompt pipelines, your eval harness — stays exactly
where it is.

**Scope is deliberately one agent.** This replaces the research agent and nothing else.

## What you implement

```ts
import { createClaudeResearchProvider, type RetrievalPort } from '@novamind/claude-research'

const port: RetrievalPort = {
  search: (query, topK) => ragService.hybridSearch(query, topK).then(toPassages),
  fetch:  (chunkIds)    => ragService.getChunks(chunkIds).then(toPassages),
}

const claude = createClaudeResearchProvider(port)
const record = await claude.research({ question })
```

`toPassages` maps your rows to `{ chunkId, documentId, title, section?, year?, text, url? }`.
Both methods almost certainly already exist inside your retrieval service. Nothing is
re-vectorised and no corpus moves.

Non-retrieval tools — the data-analysis agent's validation against client experimental data, for
instance — go in through `extraTools` as SDK `tool()` definitions, with no change to this package.

## Why this one, specifically

### 1. Hallucinated citations are structurally impossible, not statistically rare

This is the part to scrutinise, because "zero tolerance for hallucinated citations" is not a
property any model scores well enough on to satisfy on its own.

The model is never allowed to write a citation. It may only emit a `chunkId` — an opaque string
it must have received from a tool call **in this run**. After the run:

1. Every cited id is checked against the ledger of ids the retrieval tools actually returned.
2. An id that was never returned is rejected and reported. A claim whose every id was invented is
   dropped from the report, and named in `lineage.droppedClaims`.
3. Surviving ids are re-fetched, and title, document id and URL are written **from the corpus**.

So a model reciting a real PMID from training data fails the gate as hard as one inventing a fake
PMID, because neither passage was retrieved. `retrievable` is not `retrieved`. That is a
deterministic property of the pipeline, testable without calling a model:

```
test/lineage.test.ts  ✓ rejects an id that is real in the corpus but was never retrieved this run
```

See [docs/CITATIONS.md](docs/CITATIONS.md).

### 2. Structured output, enforced in the loop and verified outside it

Your benchmarks showing GPT-5.1 ahead on structured-output reliability are worth taking at face
value — and mostly worth re-running against this shape rather than against a bare completion call.
Two layers do the work here:

- `outputFormat: { type: 'json_schema' }` constrains generation and retries a non-conforming turn
  **inside** the agent loop. Malformed JSON does not reach your code to be repaired.
- The raw final output is then parsed against the Zod contract *before* any application-side
  repair, coercion or defaulting, so the `structured_output_valid` gate measures the runtime and
  not our clean-up code.

Both stage schemas are `additionalProperties: false` at every level. A model that invents a `pmid`
field fails loudly rather than having it silently dropped.

### 3. Context isolation is what keeps a long trajectory coherent

Each searcher's tool traffic — every query, every passage — stays in that searcher's context. Only
its structured result returns to the lead. Three searchers reading 40 passages each cost the lead
three short result objects, not 120 passages of accumulated context.

This is the same subagent mechanism that runs Claude Code, and it is the direct answer to the
context-management work you have in flight: you get it as configuration rather than as a research
project.

### 4. The seam is the model-agnostic infrastructure your board is asking for

Adding a second provider is what proves the abstraction exists. Once `ResearchProvider` is real,
the third one — Gemini 3, or whatever comes next — is a file, not a quarter. Evaluating Claude
buys you the seam whether or not you adopt Claude.

## Rollout

`createRouter` decides how much traffic each provider sees. Mode is read from
`CLAUDE_RESEARCH_MODE`, so a rollout or a rollback is a deploy, not a release.

| Mode | Customer sees | Claude runs | Use |
|---|---|---|---|
| `off` | incumbent | no | default; zero cost |
| `shadow` | incumbent | yes, recorded only | **start here** — real questions, no customer risk |
| `split` | `splitPercent`% Claude | partially | graduated rollout |
| `on` | Claude | yes | after the numbers hold |

Shadow mode is not awaited and its failures are swallowed: it can add no latency to a customer
request and cannot fail one. `test/router.test.ts` pins both properties.

## Evaluation

Every run — success or failure — emits one `RunRecord` through `onRunRecord`. It carries
`runtime` as an application-owned field, so a head-to-head against the OpenAI agent is a `GROUP BY`
rather than a second pipeline. Send the same object to LangSmith as a trace and Braintrust as an
experiment row; neither becomes the source of truth for the other.

Three deterministic gates, 0 or 1, no partial credit:

| Gate | Passes when |
|---|---|
| `structured_output_valid` | raw final output parsed against the contract with no repair |
| `citation_lineage_valid` | every cited id was returned by a tool this run and still resolves |
| `tools_succeeded` | required stages ran and every tool call completed without error |

Deterministic on purpose: an experiment-to-experiment diff should measure the pipeline, not a
judge that drifts. Add your LLM judges — claim groundedness, answer relevance — on top in
Braintrust, blinded to runtime identity and with the judge model pinned, so the comparison is fair
in both directions.

## Cost and latency, measured

One run of `npm run demo`, 2 searchers, hypotheses on, 32-passage corpus:

| Stage | Model | Wall | Cost |
|---|---|---:|---:|
| literature (lead + 2 parallel searchers, 6 searches) | `claude-sonnet-5` | 40.5s | $0.149 |
| hypotheses | `claude-opus-5` | 90.8s | $0.229 |
| | | **131s** | **$0.378** |

Gates `1/1/1`, 9 of 9 citations traced to a tool call in that run.

The hypothesis stage is two thirds of the wall clock. `CLAUDE_RESEARCH_HYPOTHESES=false` gives a
literature-only run in ~40s; moving that stage to `claude-sonnet-5` roughly halves its cost. Every
knob is one environment variable — see below.

## Configuration

Namespaced on purpose. Nothing here reads, writes or collides with `OPENAI_*`, so the Claude
provider is configured, budgeted, rolled out and rolled back without touching the configuration of
the agent already in production.

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | or existing Claude Code credentials |
| `CLAUDE_RESEARCH_MODE` | `off` | `off` \| `shadow` \| `split` \| `on` |
| `CLAUDE_RESEARCH_SPLIT_PERCENT` | `0` | split mode only |
| `CLAUDE_RESEARCH_RESEARCHERS` | `3` | parallel search subagents |
| `CLAUDE_RESEARCH_LEAD_MODEL` | `claude-sonnet-5` | routes and merges |
| `CLAUDE_RESEARCH_SEARCH_MODEL` | `claude-sonnet-5` | searches and reads |
| `CLAUDE_RESEARCH_HYPOTHESIS_MODEL` | `claude-opus-5` | reads primary text, proposes |
| `CLAUDE_RESEARCH_HYPOTHESES` | `true` | `false` for a literature-only run |
| `CLAUDE_RESEARCH_MAX_FINDINGS` | `5` | per searcher; the main latency lever |
| `CLAUDE_RESEARCH_MAX_HYPOTHESES` | `3` | |
| `CLAUDE_RESEARCH_MAX_TOP_K` | `20` | ceiling on a searcher's `top_k` |
| `CLAUDE_RESEARCH_MAX_BUDGET_USD` | `5` | per run, enforced by the SDK |

Anything passed to `createClaudeResearchProvider` wins over the environment, and
`research({ question, settings })` overrides per request — a cheap tier for interactive use, a
deeper one for an overnight batch.

Two options are load-bearing for a server deployment and are set for you: `settingSources: []` and
`strictMcpConfig: true`. The agent gets exactly the tools configured in code and nothing from the
host filesystem — no `~/.claude` settings, no project `CLAUDE.md`, no developer's local MCP
servers. A run behaves identically on a laptop and in production.

## Layout

```
src/ports.ts        RetrievalPort — the only interface you implement
src/contract.ts     Zod schemas: what the model may emit vs. what consumers receive
src/tools.ts        your RAG, exposed to the agents as an in-process MCP server
src/agents.ts       subagent definitions, prompts, per-stage SDK options
src/pipeline.ts     the two staged query() calls and the citation lineage gate
src/provider.ts     the ResearchProvider seam and the rollout router
src/settings.ts     CLAUDE_RESEARCH_* configuration
src/telemetry.ts    the canonical RunRecord
src/adapters/       in-memory corpus + synthetic demo documents
examples/           run-demo.ts (CLI), serve.ts (HTTP service)
test/               21 tests, no API calls
```

## Integrating it

[`INTEGRATION_PROMPT.md`](INTEGRATION_PROMPT.md) is written to be pasted into Claude Code inside
your own repository. It reads this repo, finds your retrieval service and your research agent, and
opens a PR that adds the provider behind a shadow-mode flag without touching the OpenAI path.

[`docs/INTEGRATION.md`](docs/INTEGRATION.md) is the same work by hand.

## Honest limits

- The bundled corpus is **synthetic**. Every `DEMO-*` document is invented; the findings are not
  scientific claims. A package about citation integrity has no business shipping plausible-looking
  fake PMIDs.
- The demo retriever is BM25-ish and deliberately mediocre. Your hybrid retrieval is better; the
  port exists to reach it.
- The gates verify *lineage* — that a claim rests on a passage this run actually retrieved. They do
  not verify *entailment*, that the passage supports the claim. That needs an LLM judge, which
  belongs in Braintrust alongside these gates rather than instead of them.
- Benchmarked on one question against a 32-passage corpus. Treat the cost and latency table as a
  shape, not a number.

MIT.
