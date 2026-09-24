# Citation integrity

The requirement is "zero tolerance for hallucinated citations". No model satisfies that on its
own, and no prompt makes it true. It has to be a property of the pipeline.

## The rule

> A citation is valid only if the passage it names was returned by a retrieval tool **during this
> run**.

Not "exists in the corpus". Not "looks well-formed". Returned, this run, to this agent.

That distinction is the whole design. A model reciting a genuine PMID from training data has not
read the passage. It may be describing a real paper, correctly, and still be making the claim up —
the citation attests to nothing. The gate treats that identically to an invented id, because
epistemically it is identical.

## How it is enforced

**The model cannot author a citation.** The stage-1 schema gives it one citation field:

```ts
chunkIds: z.array(z.string()).min(1)
```

No title, no PMID, no URL, no year. Those fields do not exist in the model-facing schema, and the
schema is `additionalProperties: false`, so a model that tries to add them fails generation rather
than having them quietly dropped. The only citation move available is *copy an opaque string the
tool just gave me*.

**The tools keep a ledger.** `CorpusSession` records every `chunkId` handed out, across every
subagent, for the lifetime of one run. One session per run; sharing one across runs would let one
run's retrievals ground another run's citations.

**The gate runs before anything downstream.** `applyLineageGate` in `src/pipeline.ts`:

| Case | Result |
|---|---|
| id in the ledger | kept |
| id not in the ledger | stripped, listed in `lineage.fabricated` |
| claim with no ids left | dropped, listed in `lineage.droppedClaims` |
| all claims dropped | run fails; no report is returned |

Failures are **reported, not filtered**. A silent filter would make a hallucination invisible to
exactly the eval built to catch it. `lineage.grounded / lineage.cited` is on every run record.

**Human-readable fields are rehydrated from the corpus.** Surviving ids are re-fetched through the
port, and `documentId`, `title` and `url` are written from those rows. The string a researcher
reads in the final report has no causal path back to model output. `RetrievalPort.fetch` must omit
unknown ids rather than invent rows — that is the one contract the guarantee rests on, and it is
the contract your retrieval service already honours.

**Stage 2 cannot widen the evidence.** The hypothesis stage is given `allowedTools: [get_passages]`
and no search tool. It may re-read passages stage 1 already cited, and nothing else, so it cannot
introduce a citation that never passed the gate. The findings reach it as a TypeScript object, not
as prose one model wrote for another, so ids cross the boundary byte-for-byte.

## What this does not prove

The gate verifies **lineage**, not **entailment**. It guarantees the cited passage was retrieved
and read. It does not guarantee the passage supports the claim.

Entailment needs a judge: show it one atomic claim and only its cited passages, ask supported or
unsupported, aggregate the supported fraction. That belongs in Braintrust alongside these gates,
never instead of them — an LLM judge drifts between experiments, and a deterministic gate does
not. Read them together: lineage tells you the evidence is real, the judge tells you it is
relevant.

Claims are written atomic for this reason. A claim bundling two assertions fails a judge when
either half fails, and the score stops meaning anything useful.

## Verifying it

```bash
npm test
```

`test/lineage.test.ts` proves the properties without calling a model, including the strict one:

```
✓ rejects an id that is real in the corpus but was never retrieved this run
```

To see it on a live run, read `lineage` on the `RunRecord`. On a clean run it is
`{ cited: n, grounded: n, fabricated: [], droppedClaims: [] }` and
`gates.citationLineageValid` is `1`. Anything else is printed by `npm run demo`, loudly.
