import { describe, expect, it } from 'vitest'
import {
  literatureStageSchema,
  researchReportSchema,
  toJsonSchema,
} from '../src/contract.js'

describe('model-facing stage contract', () => {
  it('rejects a finding with no citation', () => {
    const result = literatureStageSchema.safeParse({
      synthesis: 'x',
      findings: [{ claim: 'unsourced', chunkIds: [], confidence: 'high' }],
      gaps: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unexpected property rather than ignoring it', () => {
    const result = literatureStageSchema.safeParse({
      synthesis: 'x',
      findings: [{ claim: 'c', chunkIds: ['a'], confidence: 'high', pmid: '12345678' }],
      gaps: [],
    })
    // A model that invents a `pmid` field must fail loudly. Silently dropping it would let an
    // unverified identifier look like it had been considered.
    expect(result.success).toBe(false)
  })

  it('emits a JSON Schema the API can constrain generation against', () => {
    const schema = toJsonSchema(literatureStageSchema) as Record<string, any>
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.findings.items.additionalProperties).toBe(false)
    expect(schema.required).toEqual(expect.arrayContaining(['synthesis', 'findings']))
  })
})

describe('consumer-facing contract', () => {
  it('accepts a rehydrated report', () => {
    const report = {
      question: 'q',
      synthesis: 's',
      findings: [
        {
          claim: 'c',
          citations: [{ chunkId: 'DEMO-0001:0001', documentId: 'DEMO-0001', title: 't' }],
          confidence: 'medium' as const,
        },
      ],
      hypotheses: [],
      limitations: [],
    }
    expect(researchReportSchema.parse(report)).toEqual(report)
  })

  it('rejects a finding with no citations', () => {
    const result = researchReportSchema.safeParse({
      question: 'q',
      synthesis: 's',
      findings: [{ claim: 'c', citations: [], confidence: 'low' }],
      hypotheses: [],
      limitations: [],
    })
    expect(result.success).toBe(false)
  })
})
