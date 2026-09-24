import { describe, expect, it, vi } from 'vitest'
import { createRouter, type ResearchProvider } from '../src/provider.js'
import type { RunRecord } from '../src/telemetry.js'

const record = (runtime: string): RunRecord => ({
  runId: 'r', runtime, question: 'q', status: 'complete', startedAt: '', wallMs: 1, ttftMs: 1,
  costUsd: 0, gates: { structuredOutputValid: 1, citationLineageValid: 1, toolsSucceeded: 1 },
  lineage: { cited: 0, grounded: 0, fabricated: [], droppedClaims: [] },
  stages: [], report: null, error: null,
})

const provider = (name: string, impl?: () => Promise<RunRecord>): ResearchProvider => ({
  name,
  research: impl ?? (async () => record(name)),
})

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('rollout router', () => {
  it('off: never calls the candidate', async () => {
    const candidate = vi.fn(async () => record('claude'))
    const router = createRouter({ primary: provider('openai'), candidate: provider('claude', candidate), mode: 'off' })

    expect((await router.research({ question: 'q' })).runtime).toBe('openai')
    expect(candidate).not.toHaveBeenCalled()
  })

  it('shadow: returns the incumbent answer and still runs the candidate', async () => {
    const candidate = vi.fn(async () => record('claude'))
    const router = createRouter({ primary: provider('openai'), candidate: provider('claude', candidate), mode: 'shadow' })

    expect((await router.research({ question: 'q' })).runtime).toBe('openai')
    await settled()
    expect(candidate).toHaveBeenCalledOnce()
  })

  it('shadow: a candidate failure never reaches the caller', async () => {
    const onShadowError = vi.fn()
    const router = createRouter({
      primary: provider('openai'),
      candidate: provider('claude', async () => { throw new Error('rate limited') }),
      mode: 'shadow',
      onShadowError,
    })

    // The whole point of shadow mode: the customer's request cannot be harmed by the evaluation.
    await expect(router.research({ question: 'q' })).resolves.toMatchObject({ runtime: 'openai' })
    await settled()
    expect(onShadowError).toHaveBeenCalledOnce()
  })

  it('shadow: does not wait for the candidate before answering', async () => {
    let released = () => {}
    const slow = new Promise<void>((resolve) => { released = resolve })
    const router = createRouter({
      primary: provider('openai'),
      candidate: provider('claude', async () => { await slow; return record('claude') }),
      mode: 'shadow',
    })

    await expect(router.research({ question: 'q' })).resolves.toMatchObject({ runtime: 'openai' })
    released()
  })

  it('on: answers from the candidate only', async () => {
    const primary = vi.fn(async () => record('openai'))
    const router = createRouter({ primary: provider('openai', primary), candidate: provider('claude'), mode: 'on' })

    expect((await router.research({ question: 'q' })).runtime).toBe('claude')
    expect(primary).not.toHaveBeenCalled()
  })

  it('split at 100 sends everything to the candidate, at 0 nothing', async () => {
    const all = createRouter({ primary: provider('openai'), candidate: provider('claude'), mode: 'split', splitPercent: 100 })
    const none = createRouter({ primary: provider('openai'), candidate: provider('claude'), mode: 'split', splitPercent: 0 })

    expect((await all.research({ question: 'q' })).runtime).toBe('claude')
    expect((await none.research({ question: 'q' })).runtime).toBe('openai')
  })
})
