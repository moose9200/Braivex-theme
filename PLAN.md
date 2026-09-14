# Loculens + HireSieve on braivex.com — PLAN

Started 14 Sep 2026. Owner: Hemant. Executor: Claude.

## Acceptance (each line testable; tick only with evidence in the log)
- [ ] Homepage has a new interactive "Products" section showing exactly 2 products (Loculens, HireSieve), switchable, keyboard-operable (ARIA tabs), renders at 1440px and 390px with no horizontal scroll
- [ ] Each product card: name, one-line value prop, 3 outcome bullets, animated UI preview (HTML/CSS, no video), CTA to its detail page
- [ ] `/pages/loculens` and `/pages/hiresieve` return HTTP 200 on braivex.com, using the designed `page.solution` template family, each with real product copy from the repos (no placeholder text)
- [ ] Header "Solutions" nav resolves to the new section (anchor exists on live homepage)
- [ ] `prefers-reduced-motion` disables preview animation (verified via emulation, not code-reading)
- [ ] Zero fabricated claims: every number on the product pages traces to the product README or vault note
- [ ] Theme check exit 0; GitHub→Shopify sync applied (file `updatedAt` on live theme advances); live curl shows new section
- [ ] Screenshots at 1440 and 390 attached in Evidence log, both looked at

## Facts (Verified — source: file/command/URL fetched this session)
- Loculens = Braivex product: review management for multi-location businesses; Google Business Profile / Apify / Places sources; sentiment, team-member mentions, reply tracking; multi-tenant v0.5.0, `/signup`, Stripe plans Starter/Growth/Scale, 14-day trial. Source: `gh api repos/moose9200/Loculens/readme`, vault `work/active/loculens/Loculens.md` (updated 09 Sep 2026)
- Loculens proof point: 479 real reviews across 5 Tish Lyon studios (Oxford St 168 @4.7, Liverpool 142 @5.0, Bluewater 97 @4.9, Trafford 70 @5.0, Edinburgh 2 @5.0). Source: vault note table
- HireSieve = Braivex product: AI-agent recruitment screening; LLM extracts facts with evidence quotes, deterministic Python engine scores, human decides, **nothing auto-rejects**; ~4.5p and ~45s per CV; multi-user roles owner/admin/member/viewer; plans Trial/Starter/Team/Scale (USD). Source: `gh api repos/moose9200/hiresieve-by-braivex/readme`
- HireSieve "will not do" list (verbatim positioning): no auto-reject; no AI-writing detection (misfires on ~61% non-native writers per README); no scoring of spelling/grammar/school; career gaps shown not counted; part-time not penalised; no model-invented numbers. Source: README "What it deliberately will not do"
- Theme already has an accessible tab component: `[data-bvx-tabs]` + `.bvx-tab[role=tab]` + `.bvx-panel[data-panel]`, click + ArrowLeft/Right handled in `assets/braivex.js initTabs`. Source: `sections/braivex-catalogue.liquid:17-58`, `assets/braivex.js`
- Designed product-detail template exists: `templates/page.solution.json` = braivex-page-hero → braivex-spec (label/value grid, 2-col) → braivex-cta. Source: file read
- Homepage order: hero, routes(#solutions), partners(#brands), industries(#industries), catalogue(#braivex-apps), philosophy, insights, cta(#get-started). Header nav "Solutions" → `/#braivex-apps`, "Platform" → `/#solutions`. Source: `templates/index.json`, `sections/header-group.json`
- Catalogue section currently shows 14 placeholder items ("Supply Chain Intelligence", "Neural Routing Fabric"…) — none are real products. Source: `templates/index.json` catalogue blocks
- Brand tokens: bg #000/#0a0a0a panel, ink #fff, accent cyan #00f0ff, accent-2 #0055ff, pulse #a8f6ff, hairline rgba(255,255,255,.1), radius 4px, ease cubic-bezier(.22,1,.36,1), font Assistant. Source: `assets/braivex.css :root`
- Shopify connector live this session (articleCreate succeeded 13 Sep); `pageCreate` worked earlier (Marketplace page). GitHub→Shopify sync ~60s; `url`-type settings with custom defaults are silently rejected (fixed 08 Sep). Source: session history
- ui-ux-pro-max design-system query returned "Bento Grid Showcase" pattern, mobile-stack, stagger motion 300–450ms, reduced-motion required; its palette (violet/pink) conflicts with brand and its own anti-pattern list ("AI purple/pink gradients") — palette discarded, structure kept. Source: search.py output this session

## Assumptions (to validate — how, when)
- Two-product layout: side-by-side switcher beats a grid (too few for grid, too many for one hero). Validate: research agent report on 8+ real sites, due this turn.
- Preview mockups built in HTML/CSS/SVG (no canvas, no video) are the right call for perf + reduced-motion. Validate: research agent 2 report (web.dev/MDN citations).
- Products have no public marketing URL yet (Loculens Railway domain still old name; HireSieve is .exe + `serve`). Detail-page CTA = `/pages/contact` "Request access", not an app link. Validate: ask Hemant only if a public URL should be linked; default to contact.
- Replacing the 14 placeholder catalogue items is out of scope unless Hemant says so; new section sits above catalogue and takes the `#braivex-apps` anchor so "Solutions" nav lands on real products. Validate: state in summary; reversible.

## Unknowns (investigation tasks)
- [ ] Which interactive pattern top 2-product companies use → research agent A
- [ ] ARIA/keyboard spec for tab switcher + reduced-motion handling → research agent B (WAI-ARIA APG fetch)
- [x] Do `loculens` / `hiresieve` pages already exist in Shopify → GraphQL `pages(first:25)` 14 Sep: only contact, about-us, marketplace exist. **Task:** `pageCreate` ×2 with templateSuffix `loculens` / `hiresieve` after templates sync

## Decisions (what + why + rejected)
- Reuse `initTabs` + `.bvx-tab` for the product switcher — already accessible, already styled, zero new JS for switching. Rejected: new bespoke switcher.
- Reuse `page.solution` template family for detail pages — designed for exactly this; add `page.loculens.json`, `page.hiresieve.json`. Rejected: new section type.
- Product previews = pure HTML/CSS mockups with CSS keyframes (bars growing, chat lines appearing), gated by `prefers-reduced-motion`. Rejected: video (weight, autoplay policy), canvas (second WebGL surface competing with hero).
- Keep brand palette; ignore ui-ux-pro-max violet suggestion (contradicts brand and its own anti-pattern).

## Evidence log (command → exit code / number / screenshot path)
- 14 Sep 22:58 — `gh repo list moose9200` → both repos exist, descriptions read
- 14 Sep 22:59 — `git status --porcelain | wc -l` → 0; HEAD 3027c51

## Open risks
- Shopify silently rejects invalid schema (seen 08 Sep). Mitigation: theme check + verify live `updatedAt` per new file.
- Second animated surface on homepage next to WebGL hero — keep preview animation subtle, pause when off-screen via IntersectionObserver (already used by `initReveal`).
