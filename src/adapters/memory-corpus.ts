/**
 * A dependency-free `RetrievalPort` for demos and tests.
 *
 * BM25-ish lexical scoring over an in-memory index. Deliberately not a good retriever — its job
 * is to let `npm run demo` run in 60 seconds with no Postgres, no pgvector and no embedding
 * model, so the agent architecture can be evaluated before any infrastructure is touched.
 * NovaMind's own hybrid retrieval is strictly better and is what `RetrievalPort` exists to reach.
 */

import type { Passage, RetrievalPort } from '../ports.js'
import { DEMO_DOCUMENTS, type DemoDocument } from './demo-corpus.js'

const STOP = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were with what how why which'.split(' '),
)

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOP.has(term))
}

export class InMemoryCorpus implements RetrievalPort {
  private readonly passages = new Map<string, Passage>()
  private readonly index = new Map<string, Map<string, number>>() // term -> chunkId -> count
  private readonly lengths = new Map<string, number>()
  private averageLength = 0

  constructor(documents: DemoDocument[] = DEMO_DOCUMENTS) {
    for (const document of documents) {
      document.sections.forEach((section, i) => {
        const chunkId = `${document.documentId}:${String(i + 1).padStart(4, '0')}`
        this.passages.set(chunkId, {
          chunkId,
          documentId: document.documentId,
          title: document.title,
          section: section.name,
          year: document.year,
          text: section.text,
        })
        const tokens = terms(`${document.title} ${section.text}`)
        this.lengths.set(chunkId, tokens.length)
        for (const term of tokens) {
          const postings = this.index.get(term) ?? new Map<string, number>()
          postings.set(chunkId, (postings.get(chunkId) ?? 0) + 1)
          this.index.set(term, postings)
        }
      })
    }
    const lengths = [...this.lengths.values()]
    this.averageLength = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1)
  }

  get size(): number {
    return this.passages.size
  }

  async search(query: string, topK: number): Promise<Passage[]> {
    const k1 = 1.2
    const b = 0.75
    const total = this.passages.size
    const scores = new Map<string, number>()

    for (const term of new Set(terms(query))) {
      const postings = this.index.get(term)
      if (!postings) continue
      const idf = Math.log(1 + (total - postings.size + 0.5) / (postings.size + 0.5))
      for (const [chunkId, count] of postings) {
        const length = this.lengths.get(chunkId) ?? 1
        const norm = count * (k1 + 1) / (count + k1 * (1 - b + (b * length) / this.averageLength))
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + idf * norm)
      }
    }

    return [...scores.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, topK)
      .map(([chunkId]) => this.passages.get(chunkId))
      .filter((passage): passage is Passage => passage !== undefined)
  }

  /** Unknown ids are omitted, never invented — the contract the lineage gate depends on. */
  async fetch(chunkIds: string[]): Promise<Passage[]> {
    return chunkIds
      .map((chunkId) => this.passages.get(chunkId))
      .filter((passage): passage is Passage => passage !== undefined)
  }
}
