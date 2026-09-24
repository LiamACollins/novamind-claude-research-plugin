/**
 * The seam, and the rollout switch.
 *
 * `ResearchProvider` is the abstraction NovaMind's board is asking for when it says "model
 * agnostic": one interface, one contract, more than one runtime behind it. The existing OpenAI
 * agent becomes a provider by wrapping it — see `docs/INTEGRATION.md`; this package supplies a
 * second implementation, and the router decides how much traffic each one sees.
 *
 * Note what that makes the evaluation. Not a migration with a go/no-go date, but a percentage
 * that starts at zero. Shadow mode runs Claude on real production questions, scores it against
 * the same gates, and returns the incumbent's answer to the customer every time.
 */

import type { RunRecord } from './telemetry.js'
import type { RetrievalPort } from './ports.js'
import { loadSettings, type ClaudeResearchSettings } from './settings.js'
import { runResearch } from './pipeline.js'

export type ResearchRequest = {
  question: string
  /** Per-request overrides. Merged over the provider's configured settings. */
  settings?: Partial<ClaudeResearchSettings>
}

export interface ResearchProvider {
  readonly name: string
  research(request: ResearchRequest): Promise<RunRecord>
}

export function createClaudeResearchProvider(
  port: RetrievalPort,
  settings: Partial<ClaudeResearchSettings> = {},
  name = 'claude-agent-sdk',
): ResearchProvider {
  const configured = loadSettings(settings)
  return {
    name,
    research: (request) =>
      runResearch(
        request.question,
        port,
        request.settings ? loadSettings({ ...settings, ...request.settings }) : configured,
        name,
      ),
  }
}

export type RolloutMode =
  /** Primary only. The candidate is not called; cost is zero. */
  | 'off'
  /** Primary answers. The candidate runs alongside and is only recorded. Customers see no change. */
  | 'shadow'
  /** `splitPercent` of requests are answered by the candidate. */
  | 'split'
  /** Candidate only. */
  | 'on'

export type RouterConfig = {
  /** Today's provider — the OpenAI research agent, wrapped. */
  primary: ResearchProvider
  /** This package's provider. */
  candidate: ResearchProvider
  mode?: RolloutMode
  /** 0-100. Only read in `split` mode. */
  splitPercent?: number
  /** Called when a shadow run fails. A shadow failure must never reach the caller. */
  onShadowError?: (error: unknown) => void
}

/**
 * Reads `CLAUDE_RESEARCH_MODE` and `CLAUDE_RESEARCH_SPLIT_PERCENT` when not passed explicitly,
 * so the rollout is a deploy-time environment change rather than a code change.
 */
export function createRouter(config: RouterConfig): ResearchProvider {
  const mode = (config.mode ?? process.env.CLAUDE_RESEARCH_MODE ?? 'off') as RolloutMode
  const splitPercent = config.splitPercent ?? Number(process.env.CLAUDE_RESEARCH_SPLIT_PERCENT ?? 0)

  return {
    name: `router(${mode})`,
    async research(request) {
      if (mode === 'on') return config.candidate.research(request)

      if (mode === 'split' && Math.random() * 100 < splitPercent) {
        return config.candidate.research(request)
      }

      if (mode === 'shadow') {
        // Deliberately not awaited, and deliberately swallowed. The shadow run must not add
        // latency to the customer's request and must not be able to fail it. Its RunRecord still
        // reaches telemetry through `onRunRecord`.
        void config.candidate
          .research(request)
          .catch((error) => config.onShadowError?.(error))
      }

      return config.primary.research(request)
    },
  }
}
