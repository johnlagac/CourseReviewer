# Course reviewers

Study apps for MAIDA 2027 subjects at the Asian Institute of Management. Each reviewer covers one subject: topic notes written from the course material, concept checks with revealable worked solutions, a comprehensive test across all topics, and a timed mock exam.

## Opening it

1. **Code → Download ZIP**, then unzip
2. Double-click **`index.html`**
3. Click a subject

No install, no build, no server. Works offline — the only thing that needs the network is the web font, which falls back to a system font.

**Keep the folder together.** `index.html` needs `assets/` and `subjects/` beside it.

## What's here

| | |
|---|---|
| `index.html` | Landing page, one card per subject |
| `assets/` | The shared engine — CSS and JavaScript, used by every subject |
| `subjects/str501/` | Business Statistics for Decision Making — 12 topics, 108 questions, mock final |
| `subjects/_template/` | Scaffold for a new subject |
| `HANDOVER.md` | How to build a subject: schema, question types, content contract |

## Adding a subject

Copy `subjects/_template/`, fill it in, and add a card to `index.html`. `HANDOVER.md` has the full spec — question types and tolerance rules, the CSS vocabulary, the six-beat topic shape, and the verification checklist.

Nothing in `assets/` is subject-specific. If a subject needs something the engine can't do, that's an engine change and every subject gets it.

## Built with

Plain HTML, CSS and JavaScript. No framework, no dependencies, no build step.
