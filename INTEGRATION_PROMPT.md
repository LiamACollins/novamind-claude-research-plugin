# Integration prompt

Paste the block below into Claude Code, **run from the root of your own repository**. It reads
this demo repo, finds your retrieval service and your research agent, and opens a PR that adds a
Claude provider behind a shadow-mode flag without touching the OpenAI path.

Before you start:

```bash
git clone https://github.com/LiamACollins/novamind-claude-research-plugin /tmp/claude-research
```

Then, in your repo:

```
claude
```

and paste everything between the markers.

Expect it to ask you two or three questions early — which module owns retrieval, and where the
research agent is called from. Answer them; it saves a long exploration.

---8<--- copy from here ---8<---

We are adding a Claude Agent SDK implementation of our research agent that runs BESIDE the
existing OpenAI Agents SDK one. This is an evaluation, not a migration. Read this whole brief
before touching anything.

## Reference material

The reference implementation is at /tmp/claude-research. Read these five files in full before
planning — they are the contract you are integrating against, and they are short:

- README.md            — what the package is and why it is shaped this way
- docs/INTEGRATION.md  — the integration this task automates. Follow it.
- docs/CITATIONS.md    — the citation lineage guarantee. Do not weaken it.
- src/ports.ts         — RetrievalPort, the interface I need you to implement
- src/provider.ts      — the ResearchProvider seam and the rollout router

For the Claude Agent SDK itself, use https://docs.anthropic.com/en/agent-sdk/overview. Do not
guess at SDK APIs; the reference implementation shows every call this task needs.

## Hard constraints

1. **Do not modify the OpenAI research agent, its prompts, its tools, or its call path.** If
   adding the router requires editing a call site, change only the function call itself and say
   so explicitly in your summary.
2. **Do not re-vectorise, re-chunk, re-index or copy the corpus.** The Claude provider reaches
   the existing retrieval service through RetrievalPort. If you find yourself writing an
   embedding call, stop — you have taken a wrong turn.
3. **Do not touch OPENAI_* configuration.** All new configuration is CLAUDE_RESEARCH_*, plus
   ANTHROPIC_API_KEY. Nothing new may be read by the existing code path.
4. **Default the rollout mode to `off`.** Shadow mode gets switched on by a deploy, not by a
   merge.
5. **Scope is the research agent only.** No other agent, service or pipeline changes.

## What to do

### Step 0 — orient, and ask me before planning

Find and report back, with file paths:

- the retrieval/RAG service: the function that does semantic or hybrid search, and the function
  that fetches chunks by id
- the research agent: where it is defined and where it is called from
- the shape of a retrieved chunk row — the field that is the stable chunk id, the field that is
  the document id (PMID/PMCID/DOI), title, section, text, URL
- how we currently send runs to LangSmith and to Braintrust
- package manager, test runner, TypeScript config, and whether the repo is ESM or CJS

If the retrieval service has no fetch-by-id function, or ids do not round-trip from search to
fetch, STOP and tell me. That is a real blocker and I need to know, not have it worked around.

Then ask me anything ambiguous before you write code.

### Step 1 — the port

Create the Claude provider module (follow the repo's existing structure and naming; something
like src/research/claude/). Implement RetrievalPort over the existing retrieval service, mapping
our chunk rows to Passage.

Two requirements, both non-negotiable:

- a chunkId returned by `search` must resolve through `fetch`
- `fetch` omits unknown ids — never a placeholder, never a fabricated row

Write a test for both against our real retrieval layer, using whatever fixture or test-database
pattern this repo already uses. These two properties are what the citation guarantee rests on.

### Step 2 — the provider and the seam

Add the package as a dependency. Until it is published, add it as a file dependency pointing at
/tmp/claude-research, and note in the PR description that this must become a git or registry
dependency before merge.

Define a ResearchProvider interface in our codebase (or import it), then:

- wrap the existing OpenAI research agent as a provider named `openai-agents-sdk`
- create the Claude provider with createClaudeResearchProvider(port, { onRunRecord })
- wire onRunRecord to our existing LangSmith and Braintrust clients — same sink, both runtimes,
  with `runtime` as a field so a comparison is a GROUP BY and not a second pipeline

For the OpenAI wrapper, score the gates HONESTLY. `structuredOutputValid` must be a parse of the
RAW agent output before any repair or defaulting we currently do, and `citationLineageValid` must
run applyLineageGate against the ids our OpenAI tools actually returned. A comparison where only
one side is graded strictly is worse than no comparison. If our OpenAI path does not currently
track which ids its tools returned, say so rather than hardcoding a 1 — I would rather know the
gate is unimplementable today than read a misleading number later.

### Step 3 — the router

Put both providers behind createRouter, default mode `off`, reading CLAUDE_RESEARCH_MODE. Change
the research call site to go through the router. Verify by reading the code that in `off` mode the
Claude provider is never constructed into a live call and costs nothing.

### Step 4 — verify

- typecheck, lint and the full existing test suite must pass unchanged
- add tests: the two port properties from step 1, and that `off` mode never invokes the candidate
- run the research agent once end to end in `off` mode and confirm behaviour is byte-identical to
  before the change
- then run it once with CLAUDE_RESEARCH_MODE=on against a real question and paste me the
  RunRecord's gates and lineage

Do not report success on any step you have not actually run. If something fails, show me the
output rather than working around it.

### Step 5 — the PR

Branch, commit, and open a PR titled "Add Claude Agent SDK research provider (shadow-mode, off by
default)". The description must cover:

- every file added and every file modified, with one line each on why
- the exact new environment variables and their defaults
- how to switch the shadow on, and how to roll back
- anything you could not verify, and anything you had to assume

## Finally

Summarise in under ten lines: what changed, what the end-to-end run produced, and what I need to
decide. If any hard constraint above turned out to be impossible to satisfy, lead with that.

---8<--- copy to here ---8<---

## After it finishes

Deploy with `CLAUDE_RESEARCH_MODE=shadow` and leave it a week. Then compare, by runtime:

- gate pass rates — `structured_output_valid`, `citation_lineage_valid`, `tools_succeeded`
- cost per run, and p50/p95 latency per stage
- `lineage.grounded / lineage.cited` on both sides

Add your groundedness and relevance judges in Braintrust on top of the deterministic gates,
blinded to runtime identity with the judge model pinned. Then decide with numbers.
