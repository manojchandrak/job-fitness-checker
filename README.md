# Job Fitness Checker

A Chrome extension that scores how well a LinkedIn job posting matches your resume, and shows
which keywords you have and which you're missing — right on the job page.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`job-fitness-checker`).

## Use

Open any job posting on LinkedIn. Under the company name you'll see a color-coded match badge:

- 🟢 **Green — Perfect match** (80%+ of the keywords this posting mentions are on your resume)
- 🟡 **Yellow — Decent match** (55–79%)
- 🟠 **Orange — Missing lots of requirements** (30–54%)
- 🔴 **Red — Complete mismatch** (below 30%)

A floating panel on the right side of the page lists the **matching keywords** (green) found in
both the posting and your resume, and the **missing keywords** (red) the posting mentions that
aren't on your resume.

As you open different job postings, each one's score is cached. Jobs you've already opened also
get a small badge in the results list, and a **"Sort by fitness score"** checkbox above the list
reorders whatever's been scored so far (highest first) — non-recommended jobs sink lower and
jobs you haven't opened yet sink to the bottom, since there's nothing to sort them by.

## Why only jobs you've opened get scored

LinkedIn's job list only sends the company name, title, and location for each card — the full
job description only loads once you open a posting. There's no way to score every job in the
list without actually opening each one, so this only scores (and can only sort) jobs you've
personally viewed, building up as you browse rather than requiring a slow, disruptive bulk scan.

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

- `content.js` finds the "About the job" section on the currently-open posting, extracts its
  text, and checks which keywords (from a combined resume + general-vocabulary list) appear in
  it — matching case-insensitively with word-boundary-aware regex so short keywords like "Go" or
  "AI" don't match inside unrelated words, and symbol-containing keywords like "C++" or "CI/CD"
  still match correctly.
- The match score is `matched keywords ÷ total keywords the posting mentions`.
- Scores are cached in `chrome.storage.local` keyed by job ID, so revisiting a posting or
  scrolling the list doesn't re-score it, and the list/sort features can use whatever's been
  scored across the session.
- The "Sort by fitness score" toggle reorders list items via CSS `order` (the list is a flex
  column) rather than moving LinkedIn's own DOM nodes, so it can't interfere with their
  virtualized list / Ember internals.

## Files

- `manifest.json` — MV3 manifest
- `content.js` — scoring logic, badge/panel injection, list badging + sort toggle
- `content.css` — badge, panel, and sort-toggle styling
- `icons/` — toolbar/extension icons
