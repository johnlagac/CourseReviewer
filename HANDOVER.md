# Building a course reviewer

Read this before building a new subject. It assumes you know nothing about this repo.

A **reviewer** is a single-page study app for one university subject: topic notes, concept checks with revealable solutions, a comprehensive test across all topics, and a timed mock exam. One reviewer per subject, all sharing one engine.

---

## 1. Repo structure

```
/
├── index.html                    landing page — one card per subject
├── HANDOVER.md                   this file
├── build-standalone.py           generates the single-file copies
├── assets/
│   ├── reviewer.css              all styling, ~295 lines
│   └── reviewer.js               the engine, ~820 lines
├── standalone/                   generated — one self-contained file per subject
└── subjects/
    ├── _template/index.html      copy this to start a subject
    ├── str501/index.html         the worked reference — read it
    ├── act501/index.html         the second subject
    ├── inn506/index.html         built from decks, no mock exam
    ├── dsc512/index.html         a coding subject — uses t:'code' and .codeblock,
    │   notebooks/                and ships the source notebooks beside it
    └── aid503/index.html         decks disagreed with the outline — see §11
```

**Nothing in `assets/` is subject-specific.** Do not edit it to make one subject work; if a subject needs something the engine cannot do, that is an engine feature and every subject gets it.

Folder names are lowercase (`str501`). Most web servers treat paths as case-sensitive, so lowercase avoids 404s from a mistyped capital if this is ever hosted.

### How a subject page loads

A subject is **one HTML file** — static topic content plus its question data — that pulls in the shared engine:

```html
<link rel="stylesheet" href="../../assets/reviewer.css">
...content...
<script src="../../assets/reviewer.js"></script>
<script>
  REVIEWER.init({ id:'str501', topicTitles:{…}, banks:{…}, exam:{…}, map:{…} });
</script>
```

Because the engine is a classic `<script src>` with a relative path, the page works both on Pages and from `file://` — **as long as the `assets/` folder is present**. A subject page emailed on its own will not work.

The engine exposes two things: `REVIEWER.init(config)` and `REVIEWER.theme` (`.get()` / `.set()`). Theme is stored under a single unnamespaced key so one choice follows the reader across every subject and the landing page; everything else in storage is scoped per subject. Link to `…/index.html` explicitly rather than to the folder — a bare directory URL works on a server but shows a file listing over `file://`.

---

## 2. The process for a new subject

Follow these four steps in order. Do not skip to step 4.

1. **Get and analyse the course outline.** From it, derive the subject name and the topic list that forms the backbone of the reviewer.
2. **Ask the user to upload the relevant presentations and documents.** Request them by topic so gaps are obvious.
3. **Confirm the file-to-topic mapping with the user.** Show which document covers which topic and get explicit agreement before writing anything.
4. **Build the reviewer for that subject only.**

Steps 1–3 are cheap; step 4 is expensive. Restructuring an agreed topic list takes minutes. Restructuring twelve written topics takes a day.

---

## 3. Creating the subject

```
cp -r subjects/_template subjects/<code>
```

Then, in that file:

- Set `<title>`, the `.brand` link, the `#start` heading and the footer. The brand is an
  `<a href="../../index.html">` and the rail opens with `<a class="rail-home">` — two ways back
  to the subject index. Keep both; the router ignores them because it only claims `href="#…"`.
- Build the **rail** — one `<a href="#id">` per topic, in course order. The engine reads the rail to build the router, the prev/next pager and the page counter. Add a rail link and you have added a page.
- Write one `<section id="t01">` per topic, matching the rail.
- Fill `TOPIC_TITLES`, `BANKS`, and optionally `EXAM` and `MAP`.
- Set `id:` in `REVIEWER.init()` to something unique — it namespaces `localStorage`, so two subjects sharing an id would overwrite each other's progress.
- Add a card to the root `index.html`.

**Section ids and bank keys must agree.** A `<div data-quiz="t05">` renders `BANKS.t05`. If the bank is missing you get a visible red marker on the page rather than a silent failure.

The `#test` and `#sheet` sections in the template should be copied as-is — the engine fills them by element id. Delete the `#exam` section if the subject has no mock paper, and set `exam: null`.

---

## 4. Config schema

```js
REVIEWER.init({
  id: 'str501',              // required, unique — namespaces localStorage
  topicTitles: {             // required — labels for test chips and results
    t01: 'Nature of statistics',
    t02: 'Data presentation'
  },
  banks: { t01: [ … ], t02: [ … ] },   // required — keys match data-quiz
  exam: { … } || null,                 // optional
  map:  { tree: {…}, results: {…} } || null   // optional
});
```

### Exam

Weighted scoring — each part carries `pts`, so the percentage matches the real mark allocation rather than counting items equally.

```js
var EXAM = {
  name: 'Mock Final — 18 August 2026',
  mins: 180,
  questions: [
    { n:'Question 1', t:'Short answer', stem:'<p>HTML intro, tables allowed.</p>',
      parts: [
        { l:'(a) The prompt for this part.', t:'num', a:180, tol:0.5, pts:4,
          sol:'Worked solution, revealed on grading.' },
        { l:'(b) A multiple-choice part.', t:'mc', pts:4,
          opts:['One','Two','Three','Four'], a:2, sol:'…' }
      ]}
  ]
};
```

### Decision map

An interactive "which method do I use?" click-through. Branch nodes carry `n` (next node); leaves carry `r` (a key in `results`).

```js
var MAP = {
  tree: {
    root: { q:'What kind of data do you have?', o:[
      { t:'Counts in categories', d:'A subtitle', n:'counts' },
      { t:'Ranks',                d:'Not raw numbers', r:'spearman' }
    ]},
    counts: { q:'How is it laid out?', o:[ { t:'One row', d:'…', r:'gof' } ] }
  },
  results: {
    gof:      { h:'Chi-square goodness of fit', b:'What to do. HTML allowed.', l:'#t07' },
    spearman: { h:'Spearman rank correlation',  b:'…', l:'#t10' }
  }
};
```

Set `map: null` if the subject has no genuine method-choice problem. A three-node map is worse than no map. Always put a flat lookup table in the HTML underneath it — it survives printing and JS being off.

---

## 5. Question types

Every question needs `t`, `q`, `sol`, and a `c` (concept group). Ids are assigned automatically.

```js
{t:'mc',   c:'concept', q:'…', opts:['a','b','c','d'], a:1, sol:'…'}   // a = correct index
{t:'tf',   c:'concept', q:'…', opts:['True','False'],  a:1, sol:'…'}   // never shuffled
{t:'ms',   c:'concept', q:'…', opts:[…], a:[0,2],          sol:'…'}    // all-or-nothing
{t:'num',  c:'concept', q:'…', a:27.75, rtol:0.01,         sol:'…'}
{t:'text', c:'concept', q:'…', a:['sample frame','sampling frame'], sol:'…'}
{t:'code', c:'concept', q:'…', a:['x > 5'], sol:'…'}                   // exact, case-sensitive
```

### `c` — concept groups

The comprehensive test shows **at most one question per `c` value per attempt**. Tag two or three questions about the same idea with the same `c`, and a retake asks a different one. Without this, a 30-question test will happily ask the same idea three times.

### Numeric tolerance

| Field | Meaning | Use for |
|---|---|---|
| *(omitted)* | 0.5% relative | most computed answers |
| `rtol: 0.01` | 1% relative | answers where rounding is expected |
| `tol: 0.5` | ±0.5 absolute | integers — degrees of freedom, counts |
| `unit: '%'` | store `a` as a decimal | accepts `40`, `40%` and `0.40` |

Set the tolerance from **how the answer is computed**, not by habit. A flat `tol: 1` is simultaneously too tight on ₱560,000 and absurdly loose on a ratio of 0.67. And check the boundary: `tol: 0.5` on an answer of 121.5 silently accepts 121.

Input accepts commas, currency symbols, unicode minus, a trailing `%` or `x`, and **accounting parentheses** — `(1,800)` parses as −1800.

### Text answers

**Known limit:** the edit-distance tolerance is plain Levenshtein, so it forgives one
*substitution, insertion or deletion* but not a **transposition** — `relaod` for
`reload` is two edits and is rejected. Transposed letters are among the commonest
typos, so either list the likely transposition in `a` or prefer a `mc` question where
the exact spelling is the point.


Matched **exactly after normalising** — case, punctuation and small words (`the`, `a`, `of`) are stripped — plus a bounded edit distance so one typo passes. There is deliberately **no substring matching**: it would score *"a sample frame is not what you need"* as correct. List real synonyms in `a` instead.

### Code answers

**Never use `t:'text'` for code.** `normText` lowercases, strips every operator
and bracket, and forgives two characters of typo — which between them accept
`x < 5` as an answer to `x > 5`, `range(6)` for `range(5)`, and `x != y` for
`x == y`. This was measured, not guessed.

`t:'code'` matches exactly after normalising only what is genuinely
insignificant in Python:

| Forgiven | Not forgiven |
|---|---|
| surrounding whitespace | case — `True` ≠ `true` |
| spacing around operators — `x>5` = `x > 5` | any operator or identifier difference |
| quote style — `'a'` = `"a"` | spacing *inside* a string literal |
| | anything at all in an edit-distance sense |

String literals are lifted out before the spacing rules run, so `', '.join(w)`
and `','.join(w)` stay different — the space there is data, not formatting.
Keyword boundaries survive too: `not x` never collapses to `notx`.

List every genuinely acceptable form in `a`, exactly as you would for `text`:
`a: ['xs.sort()', 'sorted(xs)']`.

### Solutions

Write `sol` to explain **why the distractors are wrong**, not only why the answer is right. That is the difference between a quiz and a reviewer. Use `<div class="steps">` for worked arithmetic — it renders as a monospace block preserving line breaks.

---

## 6. Content vocabulary

Author-facing classes. The engine owns everything else (`.q`, `.opt`, `.sol`, `.dm*`, `.exq`) — do not write those by hand.

| Class | Use |
|---|---|
| `.primer` + `.ptag` `.phook` `.pana` `.pgrid` `.pcell` | the topic opener: one memorable sentence plus a three-cell card |
| `.card` | neutral container for a worked example |
| `.note` | blue callout. Modifiers: `.why` (green), `.watch` (amber, traps), `.plain` (violet, translation), `.recap` (green, end of topic), `.scope` (red, out of scope) |
| `ol.steps` | numbered procedure with circular badges |
| `.path` | tool breadcrumb — `<span>Data</span><i>→</i><span class="last">Regression</span>` |
| `.fx` / `.fx.ans` | monospace formula block, preserves line breaks |
| `.codeblock` | source code. Python-highlighted automatically; scrolls sideways rather than wrapping, because a wrapped line reads as a different program. Use this, never `.fx`, for code |
| `.codeblock.out` | what the code printed — muted, so it reads as a result not a program |
| `.codecap` | small uppercase caption inside a code block, for a filename or a label |
| `.nblink` | link from a topic to the source notebook it was built from |
| `.ans` | inline answer badge with a small label |
| `.verdict.rej` / `.verdict.keep` | conclusion pill |
| `.tw > table.dt` | any table. **Always wrap in `.tw`** or it overflows on mobile. `td.s` = the answer, `td.m` = mono, `td.n` = right-aligned numeric |
| `.dlg` + `.fld` `.fld.key` | mock dialog box; `.key` highlights the field that matters |
| `.pill.mid` / `.pill.tp` / `.pill.fm` | topic markers under the heading |
| `data-f` | mark a formula-sheet row or card to make it filterable |

Every `<table>` goes inside `<div class="tw">`. This is the single most common way to break the mobile layout.

---

## 7. Content contract

Each topic follows six beats, in order:

1. **The idea in plain English** — `.primer`, no notation.
2. **The problem** — a concrete case with real numbers.
3. **How to solve it** — formula, or the exact tool route.
4. **Read the answer** — which number matters and the sentence to write.
5. **Recap** — `.note.recap`, exactly three bullets.
6. **Concept check** — `<div data-quiz="…">`.

Targets per subject, calibrated from STR 501: **8–15 topics, 80–140 questions, 30–60 formula-sheet rows, 1–3 mock exams**. Per topic: 6–10 questions, with at least one conceptual, one computational where applicable, and one trap mirroring a known exam trick.

These are a guide, not a ceiling — the material decides. INN 506 ran to 16 topics and DSC 512 to 20, because a 2-unit course with thirteen session notebooks genuinely has that much in it. Consolidate to roughly one topic per notebook section-group rather than splitting finely, and agree the count with the user at step 3 before writing.

**Let the assessment shape the reviewer.** Check what the exam actually asks before deciding the balance of notes to drills. DSC 512's papers hand out a docstring and mark the *method* — 6 of 10 marks for being vectorised and inside a line limit, only 4 for correctness — so its topics teach the one-liner as the answer rather than as an optimisation. A reviewer built on the assumption that exams test recall would have missed that entirely.

A subject can ship usefully at 60% — notes and concept checks, no mock exam, no decision map. Every part is optional except topics and banks.

---

## 8. Bugs already fixed — do not reintroduce

These cost real time. They are fixed in `assets/reviewer.js`; the risk is re-creating them in new content or a future engine change.

1. **Option order is stored as identity, never display position.** Shuffling must never corrupt a saved answer.
2. **Accounting parentheses negate.** `(1,800)` is −1800, not +1800.
3. **Relative tolerance by default.** A flat absolute tolerance is wrong at both ends of the scale.
4. **Text matching is exact-after-normalisation, never substring.** Substring matching accepts answers embedded in a negation.
5. **Revealing an answer before attempting it scores zero** and is labelled "Revealed — not scored", rather than silently inflating the total.
6. **Print captures the active section before expanding all of them**, so printing does not navigate the reader back to page one.
7. **`scrollRestoration = 'manual'` plus a deferred scroll on load**, or a deep-linked heading sits under the sticky top bar.
8. **Code is graded by `codeOk`, never `textOk`.** The text matcher scores `x < 5`
   as correct for `x > 5`. See "Code answers" in §5.
9. **The syntax highlighter escapes before it colours.** It runs over author-supplied
   content, so raw `<script>` in a code block must come out inert. It is also
   idempotent — a `.lit` marker stops a second pass double-escaping a block when a
   quiz mounts later and re-runs it.

---

## 9. Verification

No test framework. Drive the real page with Playwright — it is installed at `/opt/node22/lib/node_modules/playwright`, and Chromium is at `/opt/pw-browsers`.

```js
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('ERROR', e.message));
await p.goto('file:///home/user/CourseReviewer/subjects/<code>/index.html');
```

**A same-URL `page.goto` does not reload the page.** Open a fresh page per case, or a previously answered question stays locked and reports a stale verdict — this produced three phantom passes the first time round.

Checklist before shipping a subject:

1. `node --check` on any JS you touched; tag balance on the HTML.
2. Every rail link routes; deep links, back/forward, pager and arrow keys work.
3. One right and one wrong answer on every question type present.
4. Numeric inputs: the exact answer, a rounded form, a wrong value, and junk.
5. Text inputs: exact, different case, trailing period, one typo, and **the answer embedded in a wrong sentence, which must fail**.
6. Mock exam: fill with the known-correct answers and confirm it scores 100%; blank submit scores 0%.
7. No horizontal overflow at 360, 414 and 768 px — measure `document.documentElement.scrollWidth`.
8. Dark mode persists across reload; print preview shows all sections once and returns you where you were.
9. Console is clean. A failed Google Fonts request is expected offline and harmless.

---

## 10. Environment notes

- **PDF text extraction needs a virtualenv.** The system `pypdf` fails on `_cffi_backend`. Use `python3 -m venv venv && ./venv/bin/pip install pypdf`.
- **Some decks are scanned images with no text layer.** Check characters-per-page; under ~50 means there is nothing to read. Say so and ask for another format, or build from the notes — never guess at the content.
- **Google Fonts is the only external dependency.** Offline, the pages fall back to system fonts and remain usable.

---

## 11. Lessons from STR 501

**Reconcile the course outline against the materials, and tell the user when they disagree.** In STR 501 the outline listed session 10 as a teaching session; the materials showed it had been repurposed for project consultations, which shifted every post-midterm topic by one. Building from the outline would have mislabelled half the reviewer.

**Mine the slides for scope statements.** A search for "will not be" surfaced two topics the professor had explicitly excluded from the final. Those belong in a `.note.scope` block — taught briefly, never drilled.

**Verify every numeric answer independently.** Compute answers yourself rather than copying them, then check against any released solution. In STR 501 every figure matched the professor's workbook, which is what makes the mock exam trustworthy.

**State the limits in the reviewer itself.** Where a source was unusable or a mark allocation unknown, say so on the page. A student needs to know which parts are authoritative.

## 11a. Lessons from AID 503

**Reconcile the outline against the decks before deriving a single topic, not after.** AID 503's
outline and its slides disagreed in four places: session 2 was listed as statistical inference but
actually taught decision analysis and EMV; decision trees were listed in session 4 and taught in
session 2; session 3 covered both one- and two-population inference rather than the outline's split;
and session 10 was titled "Unsupervised Learning" while containing none. A topic list derived from
the outline would have been wrong about a third of the course.

**A deck's title is not its contents.** Check what is actually on the slides. Session 4's outline
title promised decision trees and predictive modelling; the deck is entirely enterprise analytics.

**Name the gaps on the page, by session.** Five decks were missing, covering unsupervised learning,
model evaluation metrics, decision trees as ML, SVM, neural networks, reinforcement learning, NLP
and interpretability. The `#start` section lists each one explicitly so a student knows what this
reviewer does not cover rather than assuming the silence means "not examinable".

**Two names for the same tool is worth a callout.** Decision-analysis trees (EMV, chance nodes) and
CART classification trees both appear in an AI course. Say which one a topic means, in a `.note.plain`
at the top, or students will revise the wrong thing.

**Known engine gap, found here:** `reviewer.js` sets the "Revealed — not scored" label only
`if (vd)`, and choice questions have no `.vd` element — so on `mc`, `tf` and `ms` items the label
never appears. The *scoring* half of bug 5 is fine (revealing still records 0 of 1); only the visible
cue is missing, on every subject. Fixing it means giving choice questions a verdict slot in the
engine.

---

## 12. Using it

**There is no hosted copy.** The reviewers are opened from disk:

1. Download the repo — **Code → Download ZIP** on the `main` branch — and unzip it.
2. Double-click **`index.html`** at the top level.
3. Click a subject card.

Everything works this way: navigation between subjects, every question type, the timed mock exam, dark mode, saved progress and printing. It has been tested end to end from a local folder with all network access blocked, and there is no degraded mode — the only thing that fails offline is the Google Fonts request, which falls back to system fonts.

**Keep the folder together.** `index.html` needs `assets/` and `subjects/` beside it. That is the cost of the shared engine: a single page moved somewhere on its own loses its styling.

That failure is silent and looks like a rendering bug rather than a missing file: the
page loads in Times New Roman with every section stacked on one scroll, the progress
counter stuck at `0 / 0` and the theme button dead. If someone reports "the visuals
broke", check the folder before reading any CSS — the console will show
`reviewer.css` and `reviewer.js` failing and `REVIEWER is not defined`.

### Standalone single-file copies

For when the folder cannot be kept together — emailing one subject, a phone, a
study folder somewhere else on disk:

```
python3 build-standalone.py            # every subject
python3 build-standalone.py act501     # just one
```

This inlines `reviewer.css` and `reviewer.js` into the subject page, turns the two
"back to subject index" links into plain text (there is no index to return to), and
writes the result to `standalone/`. Roughly 250–310 KB per subject. Everything works:
routing, every question type, the timed mock exam, the decision map, dark mode,
printing.

**These are generated files and do not update themselves.** Re-run the script after
changing a subject page or the engine, or the standalone copy silently goes stale.
The files under `subjects/` remain the source of truth.

Links point at `…/index.html` rather than at the folder, deliberately. A bare directory URL needs a server to resolve; an explicit filename works from `file://` too. Keep that convention when adding a subject card.

### If you ever want it hosted again

Any static host will serve this repo as-is, with no build step and no configuration: Cloudflare Pages, Netlify, Vercel, or a local `python3 -m http.server 8000`.

Two things are worth knowing before reaching for **GitHub Pages** specifically, because they cost an afternoon once:

- Deploys via the Actions workflow failed four times, each in about a second with no logs and no steps executed. That signature means the job never reached a runner — an environment or branch restriction, not a broken workflow.
- The `github-pages` environment pins a deployment-branch rule to whatever was default when Pages was first enabled, and changing the default branch afterwards does not rewrite it. Enabling Pages, switching the source to GitHub Actions, and moving the default off the stale `template` branch each cleared one layer without clearing the last.

The **"Deploy from a branch"** source avoids all of it — no workflow, no environment. `.nojekyll` is kept in the repo for exactly that case, because `subjects/_template/` is underscore-prefixed and Jekyll would otherwise hide it.

### A note on what is in here

This repository is public, and the reviewers reproduce course material — worked examples, data tables, and a full mock exam with its released solutions — drawn from documents marked "Confidential. Not for distribution." That was a considered decision, not an oversight. Anyone adding a subject should make the same decision knowingly rather than by default.
