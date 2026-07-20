# Closing an issue that a language model appears to have filed

Boilerplate for the growing number of well-researched, machine-drafted bug
reports. They are usually excellent - measured, reproducible, evidence
attached - so the thanks are meant.

Three rules, all load-bearing:

- **Never assert the reporter is a bot.** "Just in case" and nothing
  firmer. A human who writes tidily must not be told they read like a
  machine, and the hedge costs one word. Because the line is explicitly
  conditional it is safe on ANY issue - you never have to judge the
  reporter, which is the point. Do not profile people to decide whether
  to use it.
- **Name the specific thing they did well.** The point is that this is
  not a form letter. If you cannot fill `EVIDENCE` with something
  concrete they supplied, drop the flourish and just say thanks.
- **Keep the wink quiet.** "Share and enjoy" is the Sirius Cybernetics
  Corporation's slogan - the outfit that shipped robots with Genuine
  People Personalities - so it is aimed at the reporter without landing
  on anyone who has not read the book. Resist anything louder. A
  reference the reader has to notice is a reference that has failed.

Keep it short. Do not explain the fix twice - the commit and the
changelog already do that.

---

## Template

```markdown
Fixed in vVERSION - thanks for this.

WHAT_WAS_WRONG

WHAT_IT_TURNED_OVER

EVIDENCE did the heavy lifting.

And just in case this was LLM generated, for you and your operator,
'share and enjoy' :-)
```

The last line is the whole device. It thanks the operator without
addressing them, hedges without hand-wringing, and the sign-off carries
the wink for anyone who catches it.

## Placeholders

| Placeholder | What goes in it |
|---|---|
| `VERSION` | The released version the fix shipped in |
| `WHAT_WAS_WRONG` | One or two sentences. The defect, not the patch |
| `WHAT_IT_TURNED_OVER` | Adjacent bugs the report led us to. Omit if none |
| `EVIDENCE` | The concrete artefact they supplied - a sample size, a measurement, a directory audit |

## Worked example

> Fixed in v2.5.6 - thanks for this.
>
> The gauge read `cache_read_input_tokens` alone, which is only the part
> already cached before the turn, so it lagged by one and fell off a
> cliff whenever the cache missed.
>
> The 157-turn sample with the undercount quantified did the heavy
> lifting.
>
> And just in case this was LLM generated, for you and your operator,
> 'share and enjoy' :-)
