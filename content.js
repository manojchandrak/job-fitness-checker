// Scores the currently-open LinkedIn job against a fixed set of resume
// keywords, shows a color-coded match badge under the company name, and a
// floating panel of matched (green) / missing (red) keywords pulled from the
// job description. Also auto-scores every job in the results list in the
// background (fetched from LinkedIn's own internal API, paced with a delay —
// see fetchJobDescription) so every list item gets badged and the "Sort by
// fitness score" toggle works across the whole visible list, not just jobs
// you've clicked into.

const BADGE_ATTR = 'data-jf-badge'
const FOR_ATTR = 'data-jf-for'
const SCORE_ATTR = 'data-jf-score'
const PANEL_ID = 'jf-keyword-panel'
const STORAGE_KEY = 'jf-scores' // { [jobId]: { pct, matched, missing, ts } }

// ---- Keyword sources ----
// Extracted from /Users/manoj/resume/Manoj_Kompalli_Resume.docx's Technical
// Skills section and experience bullets.
const RESUME_KEYWORDS = [
  'JavaScript', 'PHP', 'Python', 'Java', 'C#', 'C++', 'Shell Scripting',
  'Vue.js', 'Vue', 'React', 'AngularJS', 'Angular', 'Node.js', 'Laravel', 'Zend', 'Express',
  'PHPUnit', 'Vite', 'Git', 'TFS', 'Jenkins', 'CI/CD',
  'PostgreSQL', 'Oracle', 'MySQL', 'Couchbase',
  'Drupal', 'Adobe Experience Manager', 'AEM', 'WordPress',
  'Docker', 'AWS', 'EC2', 'RDS', 'Aurora', 'IAM', 'S3', 'ECS',
  'REST API', 'REST', 'OAuth2', 'OAuth', 'JWT', 'SSO',
  'HTML5', 'HTML', 'CSS3', 'CSS', 'Bootstrap', 'ES6', 'JSON', 'AJAX',
  'Agile', 'Scrum', 'WCAG', 'Accessibility',
  'FastAPI', 'ETL', 'Argo', 'Node-RED',
  'Microservices', 'Single Page Application', 'SPA',
  'Software Architecture', 'Database Modeling', 'DevOps', 'API Design',
]

// General vocabulary so common JD terms not on the resume still surface as
// "missing" rather than being silently ignored.
const EXTRA_VOCAB = [
  'TypeScript', 'Redux', 'Next.js', 'GraphQL', 'gRPC', 'WebSockets',
  'Kubernetes', 'Terraform', 'Ansible', 'Chef', 'Puppet', 'CloudFormation', 'Serverless', 'Lambda',
  'Kafka', 'RabbitMQ', 'MongoDB', 'DynamoDB', 'Redis', 'Elasticsearch', 'SQL', 'NoSQL',
  'Spring Boot', 'Spring', 'Django', 'Flask', '.NET', '.NET Core', 'Ruby on Rails', 'Ruby',
  'Go', 'Golang', 'Rust', 'Swift', 'Kotlin', 'Objective-C',
  'Azure', 'GCP', 'Google Cloud',
  'Jest', 'Mocha', 'Cypress', 'Selenium', 'Unit Testing', 'TDD', 'BDD',
  'Machine Learning', 'AI', 'Data Science', 'LLM',
  'Webpack', 'Babel', 'Sass', 'LESS', 'Tailwind CSS', 'Tailwind', 'Material UI',
  'Nginx', 'Apache', 'Linux', 'Unix', 'Bash', 'PowerShell',
  'Figma', 'UX', 'UI', 'Design Systems', 'Storybook',
  'Mentoring', 'Leadership', 'Cross-functional', 'Stakeholder',
]

const RESUME_KEYWORD_SET = new Set(RESUME_KEYWORDS.map((k) => k.toLowerCase()))
const ALL_KEYWORDS = dedupeKeywords([...RESUME_KEYWORDS, ...EXTRA_VOCAB])

function dedupeKeywords(list) {
  const seen = new Set()
  const out = []
  for (const k of list) {
    const norm = k.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(k)
  }
  return out
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lookaround-based "word boundary" rather than \b, since \b doesn't handle
// keywords with symbols at the edges correctly (e.g. "C++", "C#", "CI/CD").
function textContainsKeyword(text, keyword) {
  const re = new RegExp(`(?<![a-zA-Z0-9])${escapeRegex(keyword)}(?![a-zA-Z0-9])`, 'i')
  return re.test(text)
}

function scoreDescription(descriptionText) {
  const jdKeywords = ALL_KEYWORDS.filter((k) => textContainsKeyword(descriptionText, k))
  const matched = jdKeywords.filter((k) => RESUME_KEYWORD_SET.has(k.toLowerCase()))
  const missing = jdKeywords.filter((k) => !RESUME_KEYWORD_SET.has(k.toLowerCase()))
  const pct = jdKeywords.length === 0 ? null : Math.round((matched.length / jdKeywords.length) * 100)
  return { matched, missing, pct }
}

// Loosened from an initial 80/55/30 split — real postings routinely mention far
// more keywords than any one resume will cover (recruiters don't expect a 100%
// match), so those thresholds graded nearly everything as a weak match. A real
// test posting with 6 solid matches against 8 gaps (43%) reads as a genuinely
// decent fit, not "missing lots of requirements."
function scoreTier(pct) {
  if (pct === null) return { tier: 'unknown', label: 'No skills detected in posting' }
  if (pct >= 65) return { tier: 'perfect', label: 'Perfect match' }
  if (pct >= 40) return { tier: 'decent', label: 'Decent match' }
  if (pct >= 20) return { tier: 'partial', label: 'Missing lots of requirements' }
  return { tier: 'mismatch', label: 'Complete mismatch' }
}

// ---- Storage ----

function loadScores() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (res) => resolve(res[STORAGE_KEY] || {}))
  })
}

async function saveScore(jobId, result) {
  const scores = await loadScores()
  scores[jobId] = { pct: result.pct, matched: result.matched, missing: result.missing, ts: Date.now() }
  await chrome.storage.local.set({ [STORAGE_KEY]: scores })
}

function currentJobId() {
  const m = location.href.match(/currentJobId=(\d+)/) || location.href.match(/\/jobs\/view\/(\d+)/)
  return m ? m[1] : null
}

// Shared multi-extension convention with H1B Identifier (which also badges
// LinkedIn job listings): both insert into one ordered stack container next
// to the company name instead of separately racing for the "next sibling"
// position, which caused mis-ordering and stale-badge bugs once two
// extensions started inserting there independently. H1B Identifier always
// prepends (top); Job Fitness Checker always appends (bottom).
function ensureBadgeStack(companyEl) {
  let stack = companyEl.nextElementSibling
  if (!stack || !stack.hasAttribute('data-ext-badge-stack')) {
    stack = document.createElement('div')
    stack.setAttribute('data-ext-badge-stack', 'true')
    stack.style.display = 'flex'
    stack.style.flexDirection = 'column'
    stack.style.alignItems = 'flex-start'
    stack.style.gap = '4px'
    companyEl.insertAdjacentElement('afterend', stack)
  }
  return stack
}

// ---- Fetching descriptions for jobs that aren't open ----
// LinkedIn's list cards carry no description text at all, but the page
// itself fetches each job's description from this internal API endpoint the
// moment you open it (found by inspecting the network panel while clicking a
// job). Calling it directly — with the same CSRF token LinkedIn's own JS
// uses — lets every list item get scored without opening it.
//
// This relies on an undocumented, unversioned internal API: the queryId's
// hash suffix is tied to LinkedIn's current frontend build and *will* go
// stale whenever they ship a new one. To survive that, capture.js (running
// in the page's own JS world) watches for LinkedIn's *own* frontend making
// this exact request — which happens every time the user opens any job
// posting — and reports the queryId it used via a CustomEvent. That's
// stored below and preferred over this hardcoded fallback, so the fallback
// is only what's used before the first such event ever fires (e.g. right
// after install, before any job has been opened).
const JOB_DESCRIPTION_QUERY_ID_FALLBACK = 'voyagerJobsDashJobPostingDetailSections.bc2eee77d01abc6616b8c8855344dfd5'
const QUERY_ID_STORAGE_KEY = 'jf-query-id'

let discoveredQueryId = null
window.addEventListener('jf-query-id-discovered', (e) => {
  const id = e.detail
  if (!id || id === discoveredQueryId) return
  discoveredQueryId = id
  chrome.storage.local.set({ [QUERY_ID_STORAGE_KEY]: id })
})

async function getQueryId() {
  if (discoveredQueryId) return discoveredQueryId
  return new Promise((resolve) => {
    chrome.storage.local.get(QUERY_ID_STORAGE_KEY, (res) => {
      resolve(res[QUERY_ID_STORAGE_KEY] || JOB_DESCRIPTION_QUERY_ID_FALLBACK)
    })
  })
}

function getCsrfToken() {
  const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function fetchJobDescription(jobId) {
  const csrfToken = getCsrfToken()
  if (!csrfToken) return null
  const queryId = await getQueryId()
  const variables = `(cardSectionTypes:List(JOB_DESCRIPTION_CARD),jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A${jobId},includeSecondaryActionsV2:true)`
  const url = `https://www.linkedin.com/voyager/api/graphql?variables=${variables}&queryId=${queryId}`
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1', 'csrf-token': csrfToken },
    })
    if (!res.ok) return null
    const json = await res.json()
    for (const item of json.included || []) {
      const text = item?.description?.text || item?.descriptionText?.text
      if (text) return text
    }
    return null
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Serial background queue so a burst of new list items (initial page load,
// or scrolling in more results) doesn't fire dozens of requests at once —
// LinkedIn's own UI never does that, and this shouldn't either.
const queuedIds = new Set()
const pendingQueue = []
let queueRunning = false

function enqueueDescriptionFetch(jobId) {
  if (queuedIds.has(jobId)) return
  queuedIds.add(jobId)
  pendingQueue.push(jobId)
  runQueue()
}

async function runQueue() {
  if (queueRunning) return
  queueRunning = true
  while (pendingQueue.length > 0) {
    const jobId = pendingQueue.shift()
    const descriptionText = await fetchJobDescription(jobId)
    if (descriptionText) {
      const result = scoreDescription(descriptionText)
      await saveScore(jobId, result)
      badgeListItems()
    }
    queuedIds.delete(jobId)
    await sleep(400)
  }
  queueRunning = false
}

// ---- Detail pane: badge + keyword panel for the open job ----

const DETAIL_COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name a',
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name a',
  '.jobs-unified-top-card__company-name',
]

function findDetailCompanyElement() {
  for (const sel of DETAIL_COMPANY_SELECTORS) {
    const el = document.querySelector(sel)
    if (el && el.textContent.trim()) return el
  }
  return null
}

function findDescriptionText() {
  const heading = [...document.querySelectorAll('h2, h3')].find((h) => /about the job/i.test(h.textContent))
  const container = heading?.nextElementSibling
  return container?.textContent?.trim() || null
}

function makeDetailBadge(result) {
  const { tier, label } = scoreTier(result.pct)
  const badge = document.createElement('div')
  badge.setAttribute(BADGE_ATTR, 'true')
  badge.className = `jf-badge jf-badge-${tier}`
  const pctText = result.pct === null ? '' : `${result.pct}% match &mdash; `
  badge.innerHTML = `<span class="jf-badge-dot"></span> ${pctText}${label}`
  badge.title = 'Job Fitness Checker: keyword overlap between this posting and your resume. Not a guarantee of fit either way.'
  return badge
}

function renderKeywordPanel(result) {
  let panel = document.getElementById(PANEL_ID)
  if (!panel) {
    panel = document.createElement('div')
    panel.id = PANEL_ID
    document.documentElement.appendChild(panel)
  }

  const matchedChips = result.matched.map((k) => `<span class="jf-chip jf-chip-match">${escapeHtml(k)}</span>`).join('')
  const missingChips = result.missing.map((k) => `<span class="jf-chip jf-chip-missing">${escapeHtml(k)}</span>`).join('')

  panel.innerHTML = `
    <div class="jf-panel-header">Job Fitness</div>
    <div class="jf-panel-section">
      <div class="jf-panel-label">Matching keywords</div>
      <div class="jf-chip-row">${matchedChips || '<span class="jf-panel-empty">None found</span>'}</div>
    </div>
    <div class="jf-panel-section">
      <div class="jf-panel-label">Missing from your resume</div>
      <div class="jf-chip-row">${missingChips || '<span class="jf-panel-empty">None</span>'}</div>
    </div>
  `
}

function removeKeywordPanel() {
  document.getElementById(PANEL_ID)?.remove()
}

function escapeHtml(s) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

async function scanDetail() {
  const companyEl = findDetailCompanyElement()
  const jobId = currentJobId()
  if (!companyEl || !jobId) {
    removeKeywordPanel()
    return
  }

  const forKey = `${jobId}`
  if (companyEl.getAttribute(FOR_ATTR) === forKey) return

  const descriptionText = findDescriptionText()
  if (!descriptionText) return // description hasn't rendered yet; a later mutation will retry

  companyEl.setAttribute(FOR_ATTR, forKey)

  const result = scoreDescription(descriptionText)
  const stack = ensureBadgeStack(companyEl)
  stack.querySelector(`[${BADGE_ATTR}]`)?.remove()
  stack.appendChild(makeDetailBadge(result))
  renderKeywordPanel(result)
  await saveScore(jobId, result)
  applySort()
}

// ---- List view: badge + sort by cached score ----

const LIST_ITEM_SELECTOR = 'li[data-occludable-job-id]'
const LIST_COMPANY_SELECTOR = '.artdeco-entity-lockup__subtitle'

function makeListBadge(pct) {
  const { tier, label } = scoreTier(pct)
  const badge = document.createElement('span')
  badge.setAttribute(BADGE_ATTR, 'true')
  badge.className = `jf-list-badge jf-list-badge-${tier}`
  badge.textContent = pct === null ? label : `${pct}% — ${label}`
  return badge
}

let sortEnabled = false

function applySort() {
  loadScores().then((scores) => {
    document.querySelectorAll(LIST_ITEM_SELECTOR).forEach((item) => {
      const jobId = item.getAttribute('data-occludable-job-id')
      const scored = scores[jobId]
      if (!sortEnabled) {
        item.style.order = ''
        return
      }
      item.style.order = scored ? String(-scored.pct) : '1'
    })
  })
}

async function badgeListItems() {
  const items = document.querySelectorAll(LIST_ITEM_SELECTOR)
  if (items.length === 0) return
  ensureSortToggle()

  const scores = await loadScores()
  items.forEach((item) => {
    const jobId = item.getAttribute('data-occludable-job-id')
    const companyEl = item.querySelector(LIST_COMPANY_SELECTOR)
    if (!companyEl || !jobId) return

    const scored = scores[jobId]
    // Include jobId (not just the score timestamp) in the key so a badge
    // left over from a *different* job — because LinkedIn recycled this
    // list item's DOM node while scrolling — still gets detected as stale
    // even before the new job has been scored.
    const forKey = scored ? `${jobId}:${scored.ts}` : `${jobId}:pending`
    if (companyEl.getAttribute(FOR_ATTR) === forKey) return

    ensureBadgeStack(companyEl).querySelector(`[${BADGE_ATTR}]`)?.remove()
    companyEl.setAttribute(FOR_ATTR, forKey)

    if (!scored) {
      enqueueDescriptionFetch(jobId)
      return
    }

    ensureBadgeStack(companyEl).appendChild(makeListBadge(scored.pct))
  })

  applySort()
}

function ensureSortToggle() {
  if (document.querySelector('[data-jf-sort-toggle]')) return
  const firstItem = document.querySelector(LIST_ITEM_SELECTOR)
  if (!firstItem) return
  const list = firstItem.closest('ul, ol') || firstItem.parentElement
  if (!list || !list.parentElement) return

  const bar = document.createElement('div')
  bar.setAttribute('data-jf-sort-toggle', 'true')
  bar.className = 'jf-sort-bar'
  bar.innerHTML = `
    <span class="jf-sort-label">
      <span class="jf-sort-checkbox" role="checkbox" aria-checked="false" tabindex="0"></span>
      Sort by fitness score (Job Fitness — scoring visible jobs in the background)
    </span>
  `
  list.parentElement.insertBefore(bar, list)

  const checkbox = bar.querySelector('.jf-sort-checkbox')
  const setChecked = (value) => {
    sortEnabled = value
    checkbox.classList.toggle('jf-sort-checkbox-checked', value)
    checkbox.setAttribute('aria-checked', String(value))
    applySort()
  }
  bar.addEventListener('click', () => setChecked(!sortEnabled))
  checkbox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setChecked(!sortEnabled)
    }
  })
}

function scanAll() {
  scanDetail()
  badgeListItems()
}

scanAll()

let debounceHandle = null
const observer = new MutationObserver(() => {
  clearTimeout(debounceHandle)
  debounceHandle = setTimeout(scanAll, 200)
})
observer.observe(document.body, { childList: true, subtree: true })
