import { describe, expect, it } from 'vitest'
import { InMemoryCorpus } from '../src/adapters/memory-corpus.js'

describe('InMemoryCorpus', () => {
  const corpus = new InMemoryCorpus()

  it('indexes every section of every demo document', () => {
    expect(corpus.size).toBe(32)
  })

  it('ranks a topical passage first', async () => {
    const hits = await corpus.search('cereblon loss of function resistance', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.documentId).toBe('DEMO-0002')
  })

  it('respects topK', async () => {
    expect(await corpus.search('degrader', 3)).toHaveLength(3)
  })

  it('round-trips a chunkId returned by search', async () => {
    const [hit] = await corpus.search('ternary complex half-life', 1)
    const [fetched] = await corpus.fetch([hit!.chunkId])
    expect(fetched).toEqual(hit)
  })

  it('omits an unknown id rather than inventing a passage', async () => {
    // The `RetrievalPort` contract the lineage gate rests on.
    expect(await corpus.fetch(['DEMO-9999:0001'])).toEqual([])
  })
})
