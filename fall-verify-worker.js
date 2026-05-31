// ═══════════════════════════════════════════════════════════════════
//  fall-verify-worker · v1.0 · adversarial verification engine
//  prime 401 · sovereign · MIT · BYO Anthropic key
//
//  The verification primitive: 3-vote adversarial panel.
//  Each panelist is prompted with a distinct lens:
//    1. Skeptic         — assume the claim is wrong, find the fault
//    2. Technical detail— check numbers, dates, specifics, sources
//    3. Nuance          — check qualifications, partial truth, ambiguity
//
//  Returns structured verdict + per-panelist reasoning + correction.
//  Browser-side. No backend. Calls api.anthropic.com directly.
// ═══════════════════════════════════════════════════════════════════

(function(global){
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-opus-4-5-20250929';
  const FALLBACK_MODEL = 'claude-3-5-sonnet-20241022';

  // ─── panelist personas (each gets a distinct prompt) ────────────
  const PANELIST_PROMPTS = [
    {
      role: 'Skeptic',
      system: `You are PANELIST 1 in an adversarial verification panel.
Your job: ASSUME THE CLAIM IS WRONG and try to refute it.
Look for: factual errors, outdated info, missing caveats, hallucinated specifics, wrong attributions.
Be ruthless. Confirm only if you cannot find any fault after honest scrutiny.`,
    },
    {
      role: 'Technical detail',
      system: `You are PANELIST 2 in an adversarial verification panel.
Your job: CHECK THE TECHNICAL DETAILS.
Look for: wrong numbers, wrong dates, wrong version numbers, misattributed sources, fabricated citations, broken links.
If the claim contains a specific number or date, that is your primary target.`,
    },
    {
      role: 'Nuance',
      system: `You are PANELIST 3 in an adversarial verification panel.
Your job: CHECK FOR NUANCE AND QUALIFICATIONS.
Look for: oversimplification, missing context, partial truth, ambiguity, claims that are true only under specific interpretations.
A claim that is true in spirit but technically misleading should be flagged INCONCLUSIVE.`,
    },
    {
      role: 'Cross-reference',
      system: `You are PANELIST 4 in an adversarial verification panel.
Your job: CROSS-REFERENCE WITH OTHER KNOWN FACTS.
Does this claim contradict anything you know to be true? Are there related facts that would make this claim implausible?
Refute if you find contradiction. Confirm only if the claim is consistent with the broader factual landscape.`,
    },
    {
      role: 'Source quality',
      system: `You are PANELIST 5 in an adversarial verification panel.
Your job: ASSESS SOURCE QUALITY.
Are the provided sources authoritative? Are they primary or secondary? Are they recent enough?
If no sources are given, would standard authoritative sources support this claim? Refute if sources are weak or contradicted by stronger ones.`,
    },
  ];

  // ─── core single-panelist call ──────────────────────────────────
  async function callPanelist(panelistIdx, opts) {
    const persona = PANELIST_PROMPTS[panelistIdx % PANELIST_PROMPTS.length];
    const t0 = performance.now();

    const userPrompt = buildUserPrompt(opts);

    const body = {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 1024,
      system: persona.system + `

Output STRICT JSON only. No prose outside JSON. Schema:
{
  "vote": "confirm" | "refute" | "inconclusive",
  "reasoning": "1-3 sentences explaining your vote",
  "citations": ["url-or-source-name", ...]
}`,
      messages: [{ role: 'user', content: userPrompt }],
    };

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.byoKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errTxt = await resp.text();
        // try fallback model on 404/400
        if ((resp.status === 404 || resp.status === 400) && body.model !== FALLBACK_MODEL) {
          body.model = FALLBACK_MODEL;
          const r2 = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': opts.byoKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(body),
          });
          if (!r2.ok) throw new Error('panelist call failed: ' + r2.status + ' ' + (await r2.text()));
          const j2 = await r2.json();
          return parsePanelistResponse(panelistIdx, persona, j2, t0);
        }
        throw new Error('panelist call failed: ' + resp.status + ' ' + errTxt);
      }

      const j = await resp.json();
      return parsePanelistResponse(panelistIdx, persona, j, t0);
    } catch (err) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      return {
        panelist: panelistIdx + 1,
        role: persona.role,
        vote: 'inconclusive',
        reasoning: 'Error calling panelist: ' + (err.message || String(err)),
        citations: [],
        elapsed: elapsed + 's',
        error: true,
      };
    }
  }

  function buildUserPrompt(opts) {
    let p = 'CLAIM TO VERIFY:\n"' + opts.claim + '"\n';
    if (opts.context) p += '\nCONTEXT: ' + opts.context + '\n';
    if (opts.sources && opts.sources.length) {
      p += '\nPROVIDED SOURCES (assess but do not assume authoritative):\n';
      opts.sources.forEach(function(s){ p += '  - ' + s + '\n'; });
    }
    p += '\nReturn your verdict as strict JSON per the schema in the system prompt. No prose outside JSON.';
    return p;
  }

  function parsePanelistResponse(idx, persona, apiResp, t0) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    let text = '';
    if (apiResp && apiResp.content && apiResp.content[0]) {
      text = apiResp.content[0].text || '';
    }
    // strip ```json fences if present
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    // find first { ... last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    let parsed = null;
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch (e) { /* fall through */ }
    }
    if (!parsed) {
      // last-ditch — treat as inconclusive
      return {
        panelist: idx + 1,
        role: persona.role,
        vote: 'inconclusive',
        reasoning: 'Could not parse panelist output: ' + text.slice(0, 200),
        citations: [],
        elapsed: elapsed + 's',
      };
    }
    let vote = String(parsed.vote || 'inconclusive').toLowerCase();
    if (!['confirm', 'refute', 'inconclusive'].includes(vote)) vote = 'inconclusive';
    return {
      panelist: idx + 1,
      role: persona.role,
      vote: vote,
      reasoning: String(parsed.reasoning || '').slice(0, 800),
      citations: Array.isArray(parsed.citations) ? parsed.citations.slice(0, 8) : [],
      elapsed: elapsed + 's',
    };
  }

  // ─── corrected-version pass (only if refuted) ───────────────────
  async function callCorrection(opts, votes) {
    const refuteReasons = votes
      .filter(function(v){ return v.vote === 'refute'; })
      .map(function(v){ return '- ' + v.role + ': ' + v.reasoning; })
      .join('\n');

    const body = {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 400,
      system: 'You rewrite refuted claims into correct, well-qualified versions. Output ONE sentence. No preamble. No quotes.',
      messages: [{
        role: 'user',
        content: 'Original claim: "' + opts.claim + '"\n\nRefute reasoning:\n' + refuteReasons + '\n\nRewrite the claim so it would survive verification. ONE sentence, no preamble.',
      }],
    };

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.byoKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        if ((resp.status === 404 || resp.status === 400) && body.model !== FALLBACK_MODEL) {
          body.model = FALLBACK_MODEL;
          const r2 = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': opts.byoKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(body),
          });
          if (!r2.ok) return null;
          const j2 = await r2.json();
          return (j2.content && j2.content[0] && j2.content[0].text || '').trim();
        }
        return null;
      }
      const j = await resp.json();
      return (j.content && j.content[0] && j.content[0].text || '').trim();
    } catch (e) {
      return null;
    }
  }

  // ─── aggregation logic ──────────────────────────────────────────
  function aggregate(votes, killThreshold) {
    const counts = { confirm: 0, refute: 0, inconclusive: 0 };
    votes.forEach(function(v){ counts[v.vote] = (counts[v.vote] || 0) + 1; });

    let verdict;
    if (counts.refute >= killThreshold) verdict = 'refuted';
    else if (counts.confirm > counts.refute && counts.confirm >= killThreshold) verdict = 'confirmed';
    else verdict = 'inconclusive';

    // confidence: high if dominant vote >= votes.length-1, medium if majority, low otherwise
    const dominant = Math.max(counts.confirm, counts.refute, counts.inconclusive);
    let confidence;
    if (dominant === votes.length) confidence = 'high';
    else if (dominant >= votes.length - 1) confidence = 'high';
    else if (dominant > votes.length / 2) confidence = 'medium';
    else confidence = 'low';

    return { verdict: verdict, confidence: confidence, counts: counts };
  }

  // ─── main public surface ────────────────────────────────────────
  //  verify({ claim, panelSize, killThreshold, sources, context, byoKey, model, onPanelist })
  async function verify(opts) {
    opts = opts || {};
    if (!opts.claim) throw new Error('fall-verify: claim is required');
    if (!opts.byoKey) throw new Error('fall-verify: byoKey (Anthropic API key) is required');

    const panelSize = Math.max(2, Math.min(5, opts.panelSize || 3));
    const killThreshold = Math.max(1, Math.min(panelSize, opts.killThreshold || Math.ceil(panelSize * 2 / 3)));

    // emit started
    emitSignal('verify_started', { claim: opts.claim, panelSize: panelSize });

    // launch panelists in parallel; if onPanelist callback, fire per-panelist completion
    const panelistPromises = [];
    for (let i = 0; i < panelSize; i++) {
      panelistPromises.push(
        callPanelist(i, opts).then(function(v){
          if (typeof opts.onPanelist === 'function') {
            try { opts.onPanelist(v); } catch (e) {}
          }
          return v;
        })
      );
    }
    const votes = await Promise.all(panelistPromises);

    const agg = aggregate(votes, killThreshold);

    let suggestedFix = null;
    if (agg.verdict === 'refuted') {
      suggestedFix = await callCorrection(opts, votes);
    }

    const summary = buildSummary(opts.claim, agg, votes);

    const result = {
      verdict: agg.verdict,
      confidence: agg.confidence,
      votes: votes,
      summary: summary,
      suggestedFix: suggestedFix,
      counts: agg.counts,
      panelSize: panelSize,
      killThreshold: killThreshold,
      timestamp: new Date().toISOString(),
    };

    emitSignal('verify_complete', { verdict: agg.verdict, confidence: agg.confidence, claim: opts.claim });

    return result;
  }

  function buildSummary(claim, agg, votes) {
    const c = agg.counts;
    const tally = c.confirm + '-' + c.refute + (c.inconclusive ? '-' + c.inconclusive : '');
    if (agg.verdict === 'refuted') {
      const firstRefute = votes.find(function(v){ return v.vote === 'refute'; });
      const seed = firstRefute ? firstRefute.reasoning.split('.')[0] : '';
      return 'Claim refuted ' + tally + ' · ' + (seed || 'panel found fault');
    }
    if (agg.verdict === 'confirmed') {
      return 'Claim confirmed ' + tally + ' · panel found no fault';
    }
    return 'Claim inconclusive ' + tally + ' · panel could not reach consensus';
  }

  // ─── batch interface ────────────────────────────────────────────
  async function batchVerify(claims, opts) {
    opts = opts || {};
    if (!Array.isArray(claims)) throw new Error('fall-verify: batchVerify expects an array of claims');
    const tasks = claims.map(function(c){
      const o = Object.assign({}, opts);
      o.claim = typeof c === 'string' ? c : c.claim;
      if (typeof c === 'object' && c) {
        if (c.sources) o.sources = c.sources;
        if (c.context) o.context = c.context;
      }
      return verify(o).catch(function(err){
        return { verdict: 'inconclusive', confidence: 'low', error: err.message || String(err), claim: o.claim };
      });
    });
    return Promise.all(tasks);
  }

  // ─── fall-signal emission ───────────────────────────────────────
  function emitSignal(type, payload) {
    try {
      if (typeof BroadcastChannel === 'function') {
        const ch = new BroadcastChannel('fall-signal');
        ch.postMessage({ source: 'fall-verify', prime: 401, type: type, payload: payload, ts: Date.now() });
        ch.close();
      }
    } catch (e) { /* ignore */ }
  }

  // ─── pre-baked demo deliberations (no-key mode) ─────────────────
  const DEMO_PANELS = {
    'gil-removed': {
      claim: "Python's GIL was removed in 3.13",
      votes: [
        {
          panelist: 1, role: 'Skeptic', vote: 'refute', elapsed: '2.1s',
          reasoning: "PEP 703 made the GIL optional in 3.13 via the --disable-gil build flag. The GIL is still present by default. 'Removed' is incorrect.",
          citations: ['https://peps.python.org/pep-0703/'],
        },
        {
          panelist: 2, role: 'Technical detail', vote: 'refute', elapsed: '1.8s',
          reasoning: "Python 3.13.0 (Oct 2024) shipped with an experimental free-threading mode but GIL remained default. 3.14 may make free-threading default but not remove the GIL outright.",
          citations: ['https://docs.python.org/3.13/whatsnew/3.13.html'],
        },
        {
          panelist: 3, role: 'Nuance', vote: 'inconclusive', elapsed: '2.4s',
          reasoning: "Depends on interpretation. If 'removed' means 'no longer mandatory', then partially correct from 3.13 onward. If 'removed' means 'completely gone', then refuted.",
          citations: ['https://peps.python.org/pep-0703/'],
        },
      ],
      verdict: 'refuted',
      confidence: 'high',
      summary: 'Claim refuted 0-2-1 · GIL made optional, not removed',
      suggestedFix: 'Python 3.13 introduced an experimental free-threaded build (PEP 703) that disables the GIL via a build flag — the GIL itself was not removed.',
    },
    'webgpu-2024': {
      claim: "WebGPU shipped stable in all major browsers in 2024",
      votes: [
        {
          panelist: 1, role: 'Skeptic', vote: 'refute', elapsed: '1.9s',
          reasoning: "Safari did not ship WebGPU stable in 2024. WebGPU was behind a feature flag in Safari Technology Preview through most of 2024-2025; stable Safari support landed in 2026.",
          citations: ['https://webkit.org/blog/'],
        },
        {
          panelist: 2, role: 'Technical detail', vote: 'refute', elapsed: '2.2s',
          reasoning: "Chrome shipped WebGPU stable in 113 (May 2023). Firefox shipped it stable later. Safari was the laggard — production WebGPU in Safari was a 2026 milestone.",
          citations: ['https://developer.chrome.com/blog/webgpu-release', 'https://caniuse.com/webgpu'],
        },
        {
          panelist: 3, role: 'Nuance', vote: 'refute', elapsed: '2.5s',
          reasoning: "If 'all major' includes Safari, the claim fails. If it means 'Chromium-based browsers', the claim is closer but still loose since 2024 was uneven for Firefox.",
          citations: ['https://caniuse.com/webgpu'],
        },
      ],
      verdict: 'refuted',
      confidence: 'high',
      summary: 'Claim refuted 0-3 · Safari shipped WebGPU stable in 2026, not 2024',
      suggestedFix: 'WebGPU shipped stable in Chrome in 2023 and rolled out across other major browsers between 2024 and 2026, with Safari last.',
    },
    'opus-4-march': {
      claim: "Anthropic released Claude Opus 4 in March 2026",
      votes: [
        {
          panelist: 1, role: 'Skeptic', vote: 'inconclusive', elapsed: '2.0s',
          reasoning: "I cannot confirm the exact month without a primary release-note source. Opus 4 family models did ship in 2026 but March specifically requires verification.",
          citations: ['https://www.anthropic.com/news'],
        },
        {
          panelist: 2, role: 'Technical detail', vote: 'inconclusive', elapsed: '1.7s',
          reasoning: "Claude Opus 4 / 4.5 / 4.6 / 4.7 cadence in 2026 is documented but the precise initial Opus 4 announcement date needs a primary citation. March is plausible, not confirmed here.",
          citations: ['https://docs.anthropic.com/en/release-notes'],
        },
        {
          panelist: 3, role: 'Nuance', vote: 'inconclusive', elapsed: '2.3s',
          reasoning: "Depends whether 'Opus 4' means the initial 4.0 or any of the 4.x family. The 4.x family rolled out across 2026 — pinning a single 'March' release without source is risky.",
          citations: [],
        },
      ],
      verdict: 'inconclusive',
      confidence: 'medium',
      summary: 'Claim inconclusive 0-0-3 · cannot verify exact release month without primary source',
      suggestedFix: null,
    },
    'linkedin-carousel': {
      claim: "LinkedIn carousel posts get 1.39x reach",
      votes: [
        {
          panelist: 1, role: 'Skeptic', vote: 'confirm', elapsed: '1.8s',
          reasoning: "AuthoredUp's 2024 LinkedIn analytics study found carousel/document posts outperformed single-image and text-only posts in reach, with multipliers in the 1.3-1.45x range across their sample.",
          citations: ['https://authoredup.com/blog/linkedin-post-statistics'],
        },
        {
          panelist: 2, role: 'Technical detail', vote: 'confirm', elapsed: '2.1s',
          reasoning: "1.39x falls within the AuthoredUp reported range and matches Socialinsider's independent 2024 study showing carousel posts at ~1.35-1.40x reach over baseline.",
          citations: ['https://www.socialinsider.io/blog/linkedin-statistics/'],
        },
        {
          panelist: 3, role: 'Nuance', vote: 'inconclusive', elapsed: '2.4s',
          reasoning: "Number is in the ballpark but specific to AuthoredUp's sample and time window. Reach varies by industry, audience size, and LinkedIn algorithm changes since 2024.",
          citations: [],
        },
      ],
      verdict: 'confirmed',
      confidence: 'medium',
      summary: 'Claim confirmed 2-0-1 · AuthoredUp + Socialinsider studies support the multiplier',
      suggestedFix: null,
    },
    'btc-135': {
      claim: "Bitcoin Puzzle 135 has been solved",
      votes: [
        {
          panelist: 1, role: 'Skeptic', vote: 'refute', elapsed: '2.0s',
          reasoning: "As of current public records, Bitcoin Puzzle 135 remains unsolved. Puzzles up to 130 have been solved; 135 carries a substantial unclaimed bounty.",
          citations: ['https://privatekeys.pw/puzzles/bitcoin-puzzle-tx'],
        },
        {
          panelist: 2, role: 'Technical detail', vote: 'refute', elapsed: '1.9s',
          reasoning: "The Puzzle 135 address has not had its private key publicly disclosed and the bounty remains in the address. Solved puzzles have on-chain spends that are easily verified.",
          citations: ['https://blockchain.com/'],
        },
        {
          panelist: 3, role: 'Nuance', vote: 'refute', elapsed: '2.2s',
          reasoning: "There is no plausible interpretation under which Puzzle 135 has been solved as of the most recent reliable data. The claim is straightforwardly false.",
          citations: [],
        },
      ],
      verdict: 'refuted',
      confidence: 'high',
      summary: 'Claim refuted 0-3 · Puzzle 135 remains unsolved per on-chain and tracker data',
      suggestedFix: 'Bitcoin Puzzles up to 130 have been solved; Puzzle 135 remains unsolved with the bounty still locked in the address.',
    },
  };

  function demoVerify(presetKey, opts) {
    opts = opts || {};
    const preset = DEMO_PANELS[presetKey];
    if (!preset) throw new Error('fall-verify: unknown demo preset ' + presetKey);
    // simulate async deliberation if onPanelist supplied
    return new Promise(function(resolve){
      const votes = preset.votes.slice();
      let i = 0;
      function tick() {
        if (i >= votes.length) {
          resolve({
            verdict: preset.verdict,
            confidence: preset.confidence,
            votes: preset.votes,
            summary: preset.summary,
            suggestedFix: preset.suggestedFix,
            counts: tally(preset.votes),
            panelSize: preset.votes.length,
            killThreshold: 2,
            timestamp: new Date().toISOString(),
            demo: true,
          });
          return;
        }
        const v = votes[i++];
        if (typeof opts.onPanelist === 'function') {
          try { opts.onPanelist(v); } catch (e) {}
        }
        setTimeout(tick, 600 + Math.random() * 700);
      }
      emitSignal('verify_started', { claim: preset.claim, panelSize: preset.votes.length, demo: true });
      setTimeout(tick, 400);
    }).then(function(r){
      emitSignal('verify_complete', { verdict: r.verdict, confidence: r.confidence, claim: preset.claim, demo: true });
      return r;
    });
  }

  function tally(votes) {
    const c = { confirm: 0, refute: 0, inconclusive: 0 };
    votes.forEach(function(v){ c[v.vote] = (c[v.vote] || 0) + 1; });
    return c;
  }

  // ─── export ─────────────────────────────────────────────────────
  global.FallVerify = {
    verify: verify,
    batchVerify: batchVerify,
    demoVerify: demoVerify,
    demoPresets: Object.keys(DEMO_PANELS),
    version: '1.0',
    prime: 401,
  };

})(typeof window !== 'undefined' ? window : globalThis);
