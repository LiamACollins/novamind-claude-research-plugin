/**
 * The downstream JSON contract.
 *
 * Two layers, deliberately:
 *
 *   1. What the *model* is allowed to emit (`literatureStageSchema`, `hypothesisStageSchema`).
 *      Citations here are bare `chunkIds` — opaque strings the model must have received from a
 *      tool call in this same run.
 *   2. What *downstream consumers* receive (`researchReportSchema`). Human-readable citation
 *      fields are rehydrated from trusted corpus metadata after the lineage gate passes.
 *
 * A model that invents a plausible-looking citation cannot get it into layer 2, because layer 2
 * is not written by a model. This is the property NovaMind's "zero tolerance for hallucinated
 * citations" requirement actually needs: structural, not statistical.
 */

import { z } from 'zod'

export const confidenceSchema = z.enum(['low', 'medium', 'high'])
export type Confidence = z.infer<typeof confidenceSchema>

// ---------------------------------------------------------------- model-facing stage schemas

/** Stage 1. Enforced by the SDK via `outputFormat: { type: 'json_schema' }`. */
export const literatureStageSchema = z
  .object({
    synthesis: z
      .string()
      .describe('Two to four sentences answering the question directly from the findings below.'),
    findings: z
      .array(
        z
          .object({
            claim: z
              .string()
              .describe('One atomic, externally verifiable claim. One sentence, no conjunctions.'),
            chunkIds: z
              .array(z.string())
              .min(1)
              .describe('Exact chunk_ids of the passages this claim came from, copied verbatim.'),
            confidence: confidenceSchema,
          })
          .strict(),
      )
      .min(1),
    gaps: z.array(z.string()).describe('What the corpus does not cover for this question.'),
  })
  .strict()

export type LiteratureStage = z.infer<typeof literatureStageSchema>

/** Stage 2. Skipped entirely when `stages.hypotheses` is false. */
export const hypothesisStageSchema = z
  .object({
    hypotheses: z
      .array(
        z
          .object({
            title: z.string(),
            statement: z.string().describe('A falsifiable mechanistic or therapeutic hypothesis.'),
            rationale: z.string().describe('Why the supplied findings make this plausible.'),
            testablePrediction: z.string(),
            suggestedExperiment: z.string(),
            confidence: confidenceSchema,
          })
          .strict(),
      )
      .min(1),
    caveats: z.array(z.string()),
  })
  .strict()

export type HypothesisStage = z.infer<typeof hypothesisStageSchema>

// ------------------------------------------------------------------ consumer-facing contract

/** Rehydrated from the corpus after the lineage gate. Never written by a model. */
export const citationSchema = z
  .object({ chunkId: z.string(), documentId: z.string(), title: z.string(), url: z.string().optional() })
  .strict()

export const findingSchema = z
  .object({
    claim: z.string(),
    citations: z.array(citationSchema).min(1),
    confidence: confidenceSchema,
  })
  .strict()

export const hypothesisSchema = hypothesisStageSchema.shape.hypotheses.element

export const researchReportSchema = z
  .object({
    question: z.string(),
    synthesis: z.string(),
    findings: z.array(findingSchema).min(1),
    hypotheses: z.array(hypothesisSchema),
    limitations: z.array(z.string()),
  })
  .strict()

export type Citation = z.infer<typeof citationSchema>
export type Finding = z.infer<typeof findingSchema>
export type Hypothesis = z.infer<typeof hypothesisSchema>
export type ResearchReport = z.infer<typeof researchReportSchema>

/**
 * Zod -> JSON Schema for the SDK's `outputFormat`.
 *
 * `io: 'input'` keeps the schema in the shape the model must *produce*. The SDK sends this to the
 * API, which constrains generation and retries a non-conforming turn inside the agent loop — so
 * malformed JSON is handled before it ever reaches application code.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>
}
