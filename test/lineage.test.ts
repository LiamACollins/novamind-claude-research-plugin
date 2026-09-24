import { describe, expect, it } from 'vitest'
import { applyLineageGate, dedupe } from '../src/pipeline.js'
import type { LiteratureStage } from '../src/contract.js'

type Findings = LiteratureStage['findings']

const finding = (claim: string, chunkIds: string[]): Findings[number] => ({
  claim,
  chunkIds,
  confidence: 'medium',
})

describe('citation lineage gate', () => {
  it('keeps claims whose every id a tool returned this run', () => {
    const findings = [finding('CRBN abundance sets degrader potency.', ['DEMO-0001:0001'])]
    const { kept, lineage } = applyLineageGate(findings, new Set(['DEMO-0001:0001']))

    expect(kept).toEqual(findings)
    expect(lineage).toEqual({ cited: 1, grounded: 1, fabricated: [], droppedClaims: [] })
  })

  it('strips a fabricated id but keeps the claim when real evidence remains', () => {
    const findings = [finding('Resistance is ligase-specific.', ['DEMO-0002:0001', 'DEMO-9999:0001'])]
    const { kept, lineage } = applyLineageGate(findings, new Set(['DEMO-0002:0001']))

    expect(kept[0]?.chunkIds).toEqual(['DEMO-0002:0001'])
    expect(lineage.fabricated).toEqual(['DEMO-9999:0001'])
    expect(lineage.grounded).toBe(1)
    expect(lineage.cited).toBe(2)
  })

  it('drops a claim whose every id was invented, and names it', () => {
    const findings = [
      finding('Real claim.', ['DEMO-0003:0001']),
      finding('A confident claim resting on nothing.', ['DEMO-1234:0007', 'DEMO-1234:0008']),
    ]
    const { kept, lineage } = applyLineageGate(findings, new Set(['DEMO-0003:0001']))

    expect(kept).toHaveLength(1)
    expect(kept[0]?.claim).toBe('Real claim.')
    expect(lineage.droppedClaims).toEqual(['A confident claim resting on nothing.'])
    // Reported, not silently filtered: a hidden failure is invisible to the eval meant to catch it.
    expect(lineage.fabricated).toEqual(['DEMO-1234:0007', 'DEMO-1234:0008'])
  })

  it('rejects an id that is real in the corpus but was never retrieved this run', () => {
    // The strict property: retrievable is not the same as retrieved. A model reciting a real id
    // from training data or from an earlier run has still not read the passage.
    const findings = [finding('Plausible and wrong.', ['DEMO-0016:0001'])]
    const { kept, lineage } = applyLineageGate(findings, new Set(['DEMO-0001:0001']))

    expect(kept).toHaveLength(0)
    expect(lineage.grounded).toBe(0)
  })
})

describe('dedupe', () => {
  it('drops a restatement and a claim resting on identical evidence', () => {
    const findings = [
      finding('CRBN abundance sets potency.', ['a']),
      finding('crbn  abundance   sets potency.', ['b']),
      finding('A different sentence entirely.', ['a']),
      finding('Genuinely new.', ['c']),
    ]
    expect(dedupe(findings).map((f) => f.claim)).toEqual([
      'CRBN abundance sets potency.',
      'Genuinely new.',
    ])
  })
})
