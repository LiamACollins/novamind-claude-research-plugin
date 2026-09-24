/**
 * Agent definitions and per-stage option builders.
 *
 * Two stages, each its own `query()` call with its own enforced output schema. They are joined
 * in TypeScript rather than by one agent narrating its results to the next, so chunkIds cross
 * the boundary byte-for-byte. Nothing a model wrote is re-parsed by another model.
 *
 * Context isolation is the other half. A searcher's tool traffic — every passage it read, every
 * query it tried — stays in that searcher's context. Only its structured result returns to the
 * lead. Three searchers reading 40 passages each cost the lead three short result objects, not
 * 120 passages of context. This is what keeps a long trajectory coherent instead of
 * progressively diluted.
 */

import type { AgentDefinition, Options } from '@anthropic-ai/claude-agent-sdk'
import { hypothesisStageSchema, literatureStageSchema, toJsonSchema } from './contract.js'
import type { ClaudeResearchSettings } from './settings.js'
import { PASSAGES_TOOL, SEARCH_TOOL, SERVER_NAME, type CorpusSession } from './tools.js'

export const RESEARCHER = 'researcher'

const SEARCHER_PROMPT = `\
You are a literature-search specialist working over NovaMind's corpus through the tools provided.
You are given one facet of a larger research question. Stay on your facet; another specialist is
covering the others.

1. Run 3-6 focused searches with search_literature. Vary the phrasing; one query rarely surfaces
   everything.
2. Read the passages. Call get_passages when a snippet is not enough to judge a claim.
3. Report your {maxFindings} strongest findings and no more. Choose the most load-bearing ones for
   your facet rather than everything you saw; a finding that restates another is wasted. Prefer
   quantitative and mechanistic statements. Note contradictions between sources. Say plainly what
   the corpus does not cover.

Work only from what the tools return. If the corpus does not support a claim, do not make it.

Each claim must be atomic: one assertion, externally verifiable, no conjunctions. The downstream
grader scores one claim at a time, and a claim bundling two assertions fails when either half does.

Cite by copying the exact chunk_ids the tools returned. The chunk_ids are how the next stage reads
the primary text, and how the pipeline verifies your citations, so they must be exact.

Copy every chunk_id character by character from the tool result. Never reconstruct one, never
adjust its formatting, and never cite a passage you did not receive from a tool in this session.
A chunk_id you did not receive will be detected and the finding discarded. If you cannot copy a
chunk_id for a finding, drop the finding.`

const LEAD_PROMPT = `\
You coordinate a literature review.

Split the user's question into {n} distinct, non-overlapping facets — mechanisms, targets,
modalities, resistance, biomarkers, clinical evidence; choose what fits the question. Invoke the
"{agent}" agent once per facet, all in a single message so they run in parallel. Give each one its
facet and the overall question.

Wait for every specialist to report, then merge. Copy each claim and every chunk_id exactly as the
specialist reported it — you are a merge step, not an editor. Never invent or alter a chunk_id.
Drop a claim when another specialist already reported the same thing. Collect their gaps.

Finally write a synthesis of two to four sentences that answers the user's question directly from
the merged findings. The synthesis must not introduce anything the findings do not support.`

const SOLO_LEAD_PROMPT = `\
You coordinate a literature review. Invoke the "{agent}" agent once with the user's question, then
return its findings as your output, copying every claim and chunk_id exactly as reported. Never
invent or alter a chunk_id. Then write a synthesis of two to four sentences answering the question
directly from those findings, introducing nothing they do not support.`

const HYPOTHESIS_PROMPT = `\
You are a drug-discovery hypothesis generator. You are given literature findings as JSON; each
finding carries the chunk_ids of the passages it came from.

1. Read the findings, then call get_passages with those chunk_ids to read the primary text before
   building on it. The ids are valid as given — use them exactly, and do not search.
2. Propose exactly {maxHypotheses} hypotheses connecting findings in a non-obvious but
   mechanistically defensible way: new target/indication pairs, combination rationales, resistance
   mechanisms, biomarker strategies, or modality switches. Pick your strongest; do not pad.
3. Give each one a falsifiable prediction and a concrete first experiment. A prediction no result
   could refute is not a hypothesis.
4. Rate confidence honestly. Use "high" only where several independent articles converge.

Ground every hypothesis in the findings supplied. Do not introduce outside claims. Record anything
that weakened your confidence as a caveat.`

/**
 * Options shared by every stage.
 *
 * `settingSources: []` and `strictMcpConfig: true` are the load-bearing pair for a server
 * deployment: the agent gets exactly the tools configured here, and nothing from the host's
 * filesystem — no `~/.claude` settings, no project CLAUDE.md, no developer's local MCP servers.
 * A run behaves identically on a laptop and in production.
 */
function base(settings: ClaudeResearchSettings): Partial<Options> {
  return {
    permissionMode: 'dontAsk',
    settingSources: [],
    strictMcpConfig: true,
    maxBudgetUsd: settings.maxBudgetUsd,
    ...(settings.apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: settings.apiKey } } : {}),
  }
}

export function literatureOptions(session: CorpusSession, settings: ClaudeResearchSettings): Options {
  const { researchers, maxFindingsPerResearcher } = settings
  const prompt =
    researchers > 1
      ? LEAD_PROMPT.replace('{n}', String(researchers)).replace('{agent}', RESEARCHER)
      : SOLO_LEAD_PROMPT.replace('{agent}', RESEARCHER)

  // Enforce the cap in the schema as well as the prompt. maxItems makes the API reject an
  // over-long merge and retry inside the agent loop, so the latency saving cannot be quietly
  // ignored by a model in a generous mood.
  const schema = toJsonSchema(literatureStageSchema)
  const properties = schema.properties as Record<string, Record<string, unknown>>
  if (!properties.findings) throw new Error('literature schema lost its findings property')
  properties.findings.maxItems = maxFindingsPerResearcher * researchers

  const researcher: AgentDefinition = {
    description: 'Searches the corpus for one facet of a research question.',
    prompt: SEARCHER_PROMPT.replace('{maxFindings}', String(maxFindingsPerResearcher)),
    tools: [SEARCH_TOOL, PASSAGES_TOOL, ...settings.extraTools.map((t) => `mcp__${SERVER_NAME}__${t.name}`)],
    model: settings.models.searcher,
    effort: settings.effort.searcher,
    maxTurns: 30,
  }

  return {
    ...base(settings),
    model: settings.models.lead,
    systemPrompt: prompt,
    agents: { [RESEARCHER]: researcher },
    mcpServers: { [SERVER_NAME]: session.server },
    // The lead delegates and merges. It gets the Agent tool and nothing else — no file access,
    // no shell, and not even the corpus tools, so it cannot quietly do the research itself.
    tools: ['Agent'],
    allowedTools: ['Agent', SEARCH_TOOL, PASSAGES_TOOL],
    outputFormat: { type: 'json_schema', schema },
    effort: settings.effort.lead,
    maxTurns: 6 + researchers,
    env: {
      ...(base(settings).env ?? process.env),
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(researchers),
    },
  }
}

export function hypothesisOptions(session: CorpusSession, settings: ClaudeResearchSettings): Options {
  return {
    ...base(settings),
    model: settings.models.hypothesis,
    systemPrompt: HYPOTHESIS_PROMPT.replace('{maxHypotheses}', String(settings.maxHypotheses)),
    mcpServers: { [SERVER_NAME]: session.server },
    // Read-only by construction: this stage may re-read the passages stage 1 cited and nothing
    // else. It cannot search for new evidence, so it cannot cite anything unverified.
    tools: [],
    allowedTools: [PASSAGES_TOOL],
    outputFormat: { type: 'json_schema', schema: toJsonSchema(hypothesisStageSchema) },
    effort: settings.effort.hypothesis,
    maxTurns: 20,
  }
}
