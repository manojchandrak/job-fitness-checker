# Job Fitness Checker

A Chrome extension that scores how well a LinkedIn job posting matches your resume, and shows
which keywords you have and which you're missing — right on the job page.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`job-fitness-checker`).

## Use

Open any job posting on LinkedIn. Under the company name you'll see a color-coded match badge:

- 🟢 **Green — Perfect match** (65%+ of the keywords this posting mentions are on your resume)
- 🟡 **Yellow — Decent match** (40–64%)
- 🟠 **Orange — Missing lots of requirements** (20–39%)
- 🔴 **Red — Complete mismatch** (below 20%)

(Loosened from an initial 80/55/30 split — real postings mention far more keywords than any one
resume covers, and recruiters don't expect a 100% match, so the stricter thresholds graded
almost everything as a weak match.)

A floating panel on the right side of the page lists the **matching keywords** (green) found in
both the posting and your resume, and the **missing keywords** (red) the posting mentions that
aren't on your resume.

Every job in the results list gets scored and badged automatically in the background — not just
ones you've opened — and a **"Sort by fitness score"** checkbox above the list reorders them
(highest first). New jobs that scroll into view get queued and scored the same way.

## How every list item gets scored without opening it

LinkedIn's job list only sends the company name, title, and location for each card — the full
job description isn't there. But the page itself fetches each job's description from an internal
API the moment you open one; calling that same endpoint directly (with the same CSRF token
LinkedIn's own JS sends) gets the description for any job ID without opening it or navigating
anywhere. Requests are queued and paced (~400ms apart) rather than fired all at once for a batch
of new list items.

This relies on an **undocumented, unversioned internal API** — specifically a `queryId` whose
hash suffix is tied to LinkedIn's current frontend build. When LinkedIn ships a new build, that
hash goes stale and `fetchJobDescription()` in `content.js` starts silently returning nothing
(badging/scoring won't error, it'll just stop finding new results) until it's updated to match a
fresh `queryId` — open a job on LinkedIn, check the Network tab for a request containing
`JOB_DESCRIPTION_CARD`, and copy its `queryId` value into the `JOB_DESCRIPTION_QUERY_ID` constant
near the top of `content.js`.

## The keyword baseline

The scoring keyword list is extracted from `/Users/manoj/resume/Manoj_Kompalli_Resume.docx`'s
Technical Skills section and experience bullets, plus a broader general vocabulary (cloud,
frameworks, databases, testing, methodologies) so common terms the resume doesn't mention still
show up correctly as "missing" rather than being silently ignored. To update it after editing
your resume, edit the `RESUME_KEYWORDS` array at the top of `content.js` and reload the
extension.

**Read the score as a rough keyword-overlap signal, not a real fitness assessment** — it doesn't
understand synonyms, seniority level, or years-of-experience requirements, and a job can be a
great fit with a low score (or vice versa) if the posting is light on specific tech keywords.

## How it works

- For the currently-open posting, `content.js` reads the description straight out of the "About
  the job" section already in the DOM. For every other job in the list, it fetches the
  description from LinkedIn's internal API (see above) via a background queue.
- Either way, the text is checked against a combined resume + general-vocabulary keyword list —
  matching case-insensitively with word-boundary-aware regex so short keywords like "Go" or "AI"
  don't match inside unrelated words, and symbol-containing keywords like "C++" or "CI/CD" still
  match correctly.
- The match score is `matched keywords ÷ total keywords the posting mentions`.
- Scores are cached in `chrome.storage.local` keyed by job ID, so nothing gets re-scored or
  re-fetched once it's been done, and the list/sort features use whatever's been scored so far.
- The "Sort by fitness score" toggle reorders list items via CSS `order` (the list is a flex
  column) rather than moving LinkedIn's own DOM nodes, so it can't interfere with their
  virtualized list / Ember internals.

## Files

- `manifest.json` — MV3 manifest
- `content.js` — scoring logic, badge/panel injection, list badging + sort toggle
- `content.css` — badge, panel, and sort-toggle styling
- `icons/` — toolbar/extension icons
