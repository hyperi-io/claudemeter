# Context-rot tiers - the long-context notes

Why the blue "context rot" tiers sit where they do. Written down so the next
model bump is a quick re-check, not a fresh dig every time.

- First dug into this 30 May 2026. Last re-checked 7 July 2026. This is the
Derek rewrite and update.
- Model in question: Claude Opus 4.8 (`claude-opus-4-8`, out 28 May 2026).
- The number we lean on: GraphWalks BFS F1, from Anthropic's own system card
  (section 8.9).

## The short version

Anthropic publishes exactly two long-context data points for 4.8: BFS recall
at 256K (85.9%) and at 1M (68.1%). Everything in between is us drawing a line
between two dots, not measuring anything. That is the whole story, and it has
not changed since we started.

4.8 holds long context far better than 4.7 - it degrades about half as fast
across the span. So on paper the tiers should fire later than they did on 4.7.
We pull them back in a bit anyway, because we assume people are packing the
window with code (see CAG below), which is the punishing case. The two effects
partly cancel out. Where the tiers land is a judgement call, and the tooltip
says as much.

## What we actually know

GraphWalks BFS F1 - the only long-context retrieval number in the 4.8 card.
Higher is better. "256K" is the (128K, 256K] bin, "1M" is the (524K, 1024K]
bin filtered to problems that reproduce under the public 1M API limit.

| Model     | BFS 256K | BFS 1M | keeps at 1M |
|-----------|----------|--------|-------------|
| Opus 4.6  | 61.1%    | 16.3%  | ~27%        |
| Opus 4.7  | 76.9%    | 40.3%  | ~52%        |
| Opus 4.8  | 85.9%    | 68.1%  | ~79%        |
| GPT-5.5   | 73.7%    | 45.4%  | ~62%        |

The one-line version: 4.8 recall falls from 85.9% to 68.1% between 256K and
1M - about 18 points - and we have no idea what the curve looks like in the
middle. It could be a gentle slope or a cliff near the 524K bin edge. Nobody
has published the shape.

(Parents subtask for 4.8, for completeness: 99.3% at 256K, 83.3% at 1M. All
4.8 figures averaged over 5 trials.)

## The gap nobody has measured

Both our tiers land between 256K and 1M, and there is no data in there. Not for
4.8, not for any Opus 4.x. Two bins and that is it. Anyone who tells you where
recall sits at 500K is guessing off the same two endpoints we are.

The 7 July sweep confirmed this the boring way - fiction.liveBench, RULER,
NoLiMa, HELMET, Artificial Analysis and the July crop of 4.8 write-ups. Nobody
has a depth-binned 4.8 number in the 256K-to-1M gap. The two anchor numbers got
re-confirmed across several independent sources, so at least the endpoints are
solid.

The general research does back staying conservative. The RULER work (now widely
cited) says frontier models really only use about 50-65% of their advertised
window for multi-hop work, and advertised-vs-real diverges by 30-60 points once
you push past 200K. So trusting the nominal window is a mistake, and pulling the
tiers earlier than the raw endpoints suggest is the safer read.

## Why we assume the window is full of code (CAG)

Working assumption: modern coding use is cache-augmented. The window gets
pre-loaded with dense reference material - whole files, specs, repo slices -
rather than filled up by back-and-forth chat.

That matters because a coder sitting at 400K used is carrying 400K of code the
model has to retrieve accurately on demand. That is the hard multi-hop case
GraphWalks measures, not the easy single-fact case. So GraphWalks BFS is the
right curve to read for our users, and the tiers should sit toward the earlier,
more cautious end of whatever the endpoints allow. Plain conversational use
degrades later than this - but that is not who we are calibrating for.

## Where the tiers sit, and why

Two tiers, two meanings:

- **Light blue - awareness.** "Start to keep an eye on it." Recall has clearly
  left its short-context baseline. Drift is plausible even though most single
  asks still land fine.
- **Dark blue - do something.** Degradation bad enough that multi-step work
  will start dropping rules and facts unless you `/compact` or restart.

Reading off the two endpoints and biasing earlier for the CAG case, the
defensible band is roughly:

- Awareness starts somewhere around 400-550K.
- Real drift somewhere around 650-800K.

These are interpolated, not measured, and the tooltip and README flag that.

**What we shipped (7 July 2026):** we moved the tiers out toward that band -
rotLight 300K -> 400K, rotDeep 500K -> 650K. They had been sitting at the old
4.7-era positions, which fire too early for 4.8: a "start to worry" at 300K goes
off while 4.8 at 256K is still scoring 85.9% BFS, which is plainly premature for
this model. We kept them at the cautious end of the reasoned band rather than
the naive-endpoint end, to respect the CAG pull. The change lives in both
`src/tk/profiles.js` (`STANDARD_ROT`, the `max-*`/`team-standard` profiles) and
`src/tk/thresholds.js` (`DEFAULT_ROT_*`), so the frontier is the same whether it
comes from a profile or the window-gated default. Pro/200K profiles are
untouched - rot never fires below the window anyway. Still a judgement call.
Revisit if real binned 4.8 data ever lands.

## Read this before you re-run for 4.9

The benchmark moved under us, which will bite you if you compare across cards:

- The 4.6 card published both MRCR v2 8-needle and GraphWalks BFS.
- The 4.7 card leaned on MRCR - that is where the original rot tiers came from
  (MRCR 256K 91.9% -> 59.2%, 1M 78.3% -> 32.2%, across 4.6 -> 4.7).
- The 4.8 card dropped MRCR completely. "MRCR" and "needle" appear zero times in
  244 pages. GraphWalks BFS is now the only dedicated long-context section.

So the old tiers were calibrated on MRCR and the current numbers are GraphWalks.
Do not compare the two directly - different task, different scale. The honest
4.7 -> 4.8 baseline is GraphWalks-to-GraphWalks (the table above), which is why
the 4.7 row there is in GraphWalks terms, not MRCR.

And remember GraphWalks is synthetic - a graph of hash-nodes where the model
runs BFS or names parents. It is a good proxy for multi-hop recall, not the same
thing as natural-language multi-needle retrieval. Treat anything off it as
directional, not gospel.

## Open questions for the 4.9 re-check

- What does the BFS decline actually look like between 256K and 1M - a steady
  slope, or a cliff near the 524K boundary? No data either way.
- Has anyone independent (fiction.liveBench, RULER, LongBench, NoLiMa, HELMET)
  published binned 4.8 numbers yet? Not as of 7 July 2026. fiction.liveBench is
  the most likely first source of a mid-point (it bins to 400K/1M for some
  models) - check it first next time.
- The 1M bin is filtered to API-reproducible problems. How does recall really
  behave for prompts genuinely at the 1M ceiling versus the reported 68.1%?
- 4.8 dropped MRCR. Is there any sound way to map GraphWalks BFS onto an
  MRCR-style recall % for continuity with the old tiers? If not, accept the
  break and re-baseline on GraphWalks.

## References

Primary - start here next time:

- Opus 4.8 system card (8.9 Long context: GraphWalks) -
  https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf
- Opus 4.7 system card (8.7 long context, MRCR + BFS) -
  https://cdn.sanity.io/files/4zrzovbb/website/037f06850df7fbe871e206dad004c3db5fd50340.pdf
- Opus 4.6 system card (2.18, both MRCR and GraphWalks) -
  https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd.pdf

Corroborating:

- DataCamp - Opus 4.8 writeup (restates 85.9% / 68.1%) -
  https://www.datacamp.com/blog/claude-opus-4-8
- DigitalApplied - 4.8 vs GPT-5.5 (BFS comparison) -
  https://www.digitalapplied.com/blog/claude-opus-4-8-vs-gpt-5-5-frontier-comparison
- LLM-Stats - Opus 4.8 launch (+27.8 F1 at 1M) -
  https://llm-stats.com/blog/research/claude-opus-4-8-launch
- The Zvi - Opus 4.7 capabilities (source for 4.7 MRCR 59.2% / 32.2%) -
  https://thezvi.substack.com/p/opus-47-part-2-capabilities-and-reactions
- Vellum - Opus 4.8 benchmarks explained -
  https://www.vellum.ai/blog/claude-opus-4-8-benchmarks-explained
- ofox.ai - long-context benchmarks 2026 (RULER 50-65% effective framing) -
  https://ofox.ai/blog/long-context-llm-benchmarks-200k-tokens-2026/

Worth watching - no binned 4.8 long-context data yet:

- Artificial Analysis - Opus 4.8 (aggregate AA-LCR only, <=100K docs) -
  https://artificialanalysis.ai/models/claude-opus-4-8
- Epoch - fiction.liveBench - https://epoch.ai/benchmarks/fictionlivebench
- fiction.live leaderboard (where the per-depth numbers live) -
  https://fiction.live/
- LM Council benchmarks - https://lmcouncil.ai/benchmarks
- Simon Willison - Opus 4.8 release notes -
  https://simonwillison.net/2026/May/28/claude-opus-4-8/

## Things to keep in mind

- The anchor numbers (4.8 85.9% / 68.1%, 4.7 76.9% / 40.3%, 4.6 61.1% / 16.3%)
  are solid - straight off the primary card text and tables.
- There genuinely is no intermediate-bin data. That is a fact about what has
  been published, not a gap in our search.
- The tier positions are the soft part - interpolation between two points,
  biased by the CAG assumption. The direction is sound (later than 4.7), the
  exact figures are a call.
- The 4.7 1M = 40.3% figure is not inline text in the 4.7 card (which only gives
  a 58.6% combined average). It comes from the 4.8 card's comparison column and
  secondary sources.
- The 4.7 MRCR values live in rasterised chart images, confirmed via secondary
  sources rather than the card's extractable text.
- "1M" is a bucket (524K, 1024K], not a clean 1,000,000-token point.
