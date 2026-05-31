# ◊ fall-verify

**Adversarial verification · 3-vote refute panel · prime 401 · sovereign**

> Did Claude hallucinate that? Run it through the panel.

[![MIT](https://img.shields.io/badge/license-MIT-b8974a.svg)](./LICENSE)
[![Live](https://img.shields.io/badge/live-sjgant80--hub.github.io%2Ffall--verify-d4a853.svg)](https://sjgant80-hub.github.io/fall-verify/)
[![Prime 401](https://img.shields.io/badge/prime-401-8b1a1a.svg)](#)

Every LLM application generates plausible nonsense. `fall-verify` is the gate that catches it before it propagates. A 3-vote adversarial verification panel, each panelist prompted with a distinct lens (skeptic, technical detail, nuance), aggregating to a verdict with confidence grading and — when refuted — a suggested correction.

In Simon's own deep-research workflow, the panel killed **13 of 25 plausible claims (52%)** before they reached the final report. No public competitor packages adversarial verification as a primitive. This is that primitive.

---

## Live demo

**https://sjgant80-hub.github.io/fall-verify/**

Paste a claim. Pick a panel size. Bring your own Anthropic key. Click *Run panel.* Watch three panelists deliberate in parallel and deliver a verdict.

No key? Click any of the five preset claims for a pre-baked deliberation that shows you exactly how the panel votes on a known-true, known-false, or genuinely ambiguous claim.

---

## For end users (the panel)

The landing page has five preset claims that demonstrate the spread:

| Preset | Expected verdict | Why |
|---|---|---|
| Python GIL removed in 3.13 | refuted | PEP 703 made it optional, not removed |
| WebGPU stable in all browsers in 2024 | refuted | Safari shipped in 2026 |
| Opus 4 released March 2026 | inconclusive | exact month requires primary citation |
| LinkedIn carousel 1.39x reach | confirmed | AuthoredUp study supports |
| Bitcoin Puzzle 135 solved | refuted | still unsolved per on-chain data |

Paste your own. Optionally provide source URLs (one per line) — the panel will assess them. Slide the panel size between 2 and 5. The kill threshold determines how many refute votes are needed to ship a "refuted" verdict.

Your Anthropic key never leaves your device except for calls to `api.anthropic.com`. It's stored in `localStorage` (will be encrypted IndexedDB in v1.1).

---

## For developers (the SDK)

### Install

No install. Import directly from the live URL:

```javascript
import { verify, batchVerify } from 'https://sjgant80-hub.github.io/fall-verify/fall-verify-sdk.js';
```

The SDK is ~3KB. It lazy-loads the worker (~15KB) on first call.

### Verify a single claim

```javascript
const result = await verify({
  claim: 'GPT-4 was trained on 13 trillion tokens',
  panelSize: 3,            // 2-5 · default 3
  killThreshold: 2,        // refute votes needed · default ceil(panelSize * 2/3)
  sources: [               // optional · gives panel context
    'https://arxiv.org/abs/2303.08774',
    'https://openai.com/research/gpt-4'
  ],
  context: 'Discussing model scaling trends',  // optional
  byoKey: 'sk-ant-...',                        // required
  onPanelist: (v) => console.log(v),           // optional · per-panelist stream
});

// result shape:
// {
//   verdict:    'confirmed' | 'refuted' | 'inconclusive',
//   confidence: 'high' | 'medium' | 'low',
//   votes: [
//     { panelist: 1, role: 'Skeptic',         vote: 'refute', reasoning: '...', citations: [...], elapsed: '2.1s' },
//     { panelist: 2, role: 'Technical detail', vote: 'refute', reasoning: '...', citations: [...], elapsed: '1.8s' },
//     { panelist: 3, role: 'Nuance',          vote: 'inconclusive', reasoning: '...', citations: [...], elapsed: '2.4s' },
//   ],
//   summary: 'Claim refuted 0-2-1 · GPT-4 token count never disclosed publicly',
//   suggestedFix: 'GPT-4 training token count has not been publicly disclosed by OpenAI',
//   counts: { confirm: 0, refute: 2, inconclusive: 1 },
//   panelSize: 3,
//   killThreshold: 2,
//   timestamp: '2026-05-31T12:34:56.000Z',
// }
```

### Verify many in parallel

```javascript
const results = await batchVerify([
  'Python 3.13 made the GIL optional',
  { claim: 'WebGPU shipped stable in all browsers in 2024', sources: ['https://caniuse.com/webgpu'] },
  'Bitcoin Puzzle 135 has been solved',
], {
  panelSize: 3,
  byoKey: 'sk-ant-...',
});

// → Array of result objects in the same order as input
```

### Demo mode (no API key)

```javascript
import { demoVerify } from 'https://sjgant80-hub.github.io/fall-verify/fall-verify-sdk.js';

const result = await demoVerify('gil-removed', {
  onPanelist: (v) => render(v),
});
// presets: gil-removed, webgpu-2024, opus-4-march, linkedin-carousel, btc-135
```

---

## Architecture

```
                ┌─────────────────────────────────┐
                │  index.html · landing + demo    │  (~40-50KB)
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │  fall-verify-sdk.js · ESM       │  (~2KB)
                │  thin wrapper · lazy worker     │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │  fall-verify-worker.js          │  (~15KB)
                │  panelist prompts · aggregation │
                │  correction pass · demo panels  │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                       api.anthropic.com
                       (direct browser call · BYO key)
```

### How a verification runs

1. **Convene** — N panelists (2-5) instantiated, each with a distinct adversarial system prompt
2. **Deliberate in parallel** — N concurrent calls to `api.anthropic.com/v1/messages` via `Promise.all`
3. **Parse** — each panelist returns strict JSON: `{ vote, reasoning, citations }`
4. **Aggregate** — apply `killThreshold` rule; assign confidence based on vote dominance
5. **Correct** — if `verdict === 'refuted'`, one more LLM call rewrites the claim into something that would survive

### Panelist personas

| # | Role | Lens |
|---|---|---|
| 1 | Skeptic | Assume the claim is wrong. Find the fault. |
| 2 | Technical detail | Numbers, dates, version numbers, citation integrity. |
| 3 | Nuance | Partial truth, missing qualifications, ambiguity. |
| 4 | Cross-reference | Does this contradict other known facts? |
| 5 | Source quality | Are the cited sources authoritative? |

Panelists 4 and 5 only activate when `panelSize >= 4`.

### Aggregation rules

```
verdict =
  'refuted'      if refute_votes >= killThreshold
  'confirmed'    if confirm_votes > refute_votes AND confirm_votes >= killThreshold
  'inconclusive' otherwise

confidence =
  'high'   if dominant_vote >= N-1
  'medium' if dominant_vote > N/2
  'low'    otherwise
```

---

## Tiers (Konomi shim · prime 401)

| Tier | Cost | Limits |
|---|---|---|
| Free | trial | 10 verifications/day · panel ≤ 2 · branded |
| Sovereign | MIT (BYO key) | unlimited · panel 2-5 · no branding · IndexedDB history |
| Pro | future | batch · webhook · Konomi-signed audit chain |

Paste any `sk-ant-...` key into the landing page to auto-activate Sovereign tier.

---

## Aesthetics

Luxury brutalist. Oxblood, brass, gold, cream, void.

```
--ox:           #8b1a1a   /* primary action */
--brass:        #b8974a   /* accent */
--gold:         #d4a853   /* highlight + verdict accents */
--cream:        #c4bfb2   /* body text */
--void:         #0b0a0f   /* background */

--confirmed:    #4a8a4a
--refuted:      #c8371a
--inconclusive: #c87e3a
```

Typography: Libre Baskerville (serif), Syne (display), DM Sans (body), DM Mono (mono).

Panelist cards alternate their top accent across the five panelist palette tones to feel like distinct voices.

---

## Mesh integration

`fall-verify` participates in the fallmesh:

- **BroadcastChannel**: `fall-signal` channel · emits `verify_started` and `verify_complete` events
- **Prime**: 401 (R5 mirror ring · ◐ verify)
- **CDN**: `https://sjgant80-hub.github.io/fall-verify/`

Other tools can subscribe to `verify_complete` events to audit which claims were challenged in real time.

---

## Sovereignty

- No backend.
- No tracking, no analytics, no telemetry.
- Your Anthropic key never leaves your device except for calls to `api.anthropic.com`.
- Works offline from `file://` (demo mode shows pre-baked panels).
- Single HTML + two JS files. Total payload < 60KB.
- PWA manifest baked in via `data:` URL.

---

## Why this is the frontier

The 25-claim deep-research run that killed 13 (52%) used an early version of this panel. Every plausible-sounding statistic, citation, and technical detail got the three-lens treatment. Half didn't survive.

Single-vote verification inherits the model's blind spots. The model doesn't know what it doesn't know. The panel works because **disagreement is the signal**. A 3-0 refute means the model can keep walking. A 2-1 split means the human needs to look.

No public competitor packages this as a drop-in primitive. Most "fact-check" libraries are either single-call self-critique (useless — same blind spot) or rely on a hardcoded knowledge base (useless once the topic drifts). The adversarial panel solves both: distinct lenses + LLM-as-judge + structured aggregation.

---

## Licence

MIT · Simon Gant · 2026

Built into the [fallmesh](https://github.com/sjgant80-hub) ecosystem.

`◊ earned not performed`
