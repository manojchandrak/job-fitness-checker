// Scores the currently-open LinkedIn job against a fixed set of resume
// keywords, shows a color-coded match badge under the company name, and a
// floating panel of matched (green) / missing (red) keywords pulled from the
// job description. Also badges + can sort list items by score, but only for
// jobs you've actually opened this session — LinkedIn's list cards carry no
// description text, so there's nothing to score for jobs you haven't viewed.

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

function scoreTier(pct) {
  if (pct === null) return { tier: 'unknown', label: 'No skills detected in posting' }
  if (pct >= 80) return { tier: 'perfect', label: 'Perfect match' }
  if (pct >= 55) return { tier: 'decent', label: 'Decent match' }
  if (pct >= 30) return { tier: 'partial', label: 'Missing lots of requirements' }
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

  const stale = companyEl.nextElementSibling
  if (stale?.hasAttribute(BADGE_ATTR)) stale.remove()
  companyEl.setAttribute(FOR_ATTR, forKey)

  const result = scoreDescription(descriptionText)
  const badge = makeDetailBadge(result)
  companyEl.insertAdjacentElement('afterend', badge)
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
    const scored = scores[jobId]
    const companyEl = item.querySelector(LIST_COMPANY_SELECTOR)
    if (!companyEl) return

    const forKey = scored ? `${jobId}:${scored.ts}` : null
    if (!scored) {
      // Nothing cached yet for this job — leave it unbadged rather than guess.
      return
    }
    if (companyEl.getAttribute(FOR_ATTR) === forKey) return

    const stale = companyEl.nextElementSibling
    if (stale?.hasAttribute(BADGE_ATTR)) stale.remove()
    companyEl.setAttribute(FOR_ATTR, forKey)
    companyEl.insertAdjacentElement('afterend', makeListBadge(scored.pct))
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
      Sort by fitness score (Job Fitness — only jobs you've opened)
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
