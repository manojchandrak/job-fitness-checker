// Runs in the page's own JS world (not the extension's isolated world), so
// it can patch the page's *own* window.fetch/XMLHttpRequest and see the
// queryId LinkedIn's own frontend uses for the job-description GraphQL call
// — the one JOB_DESCRIPTION_QUERY_ID in content.js is a hardcoded snapshot
// of. Whenever the page requests that data itself (e.g. the user opens any
// job posting), this captures the current queryId and hands it to
// content.js via a DOM CustomEvent, since this world can't reach
// chrome.storage/chrome.runtime directly.
;(function () {
  function reportQueryId(url) {
    try {
      if (!url || !url.includes('/voyager/api/graphql')) return
      if (!url.includes('JOB_DESCRIPTION_CARD')) return
      const m = url.match(/[?&]queryId=([^&]+)/)
      if (!m) return
      window.dispatchEvent(new CustomEvent('jf-query-id-discovered', { detail: decodeURIComponent(m[1]) }))
    } catch {
      // never let capture logic break the page's own request
    }
  }

  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    reportQueryId(typeof input === 'string' ? input : input?.url)
    return originalFetch.apply(this, arguments)
  }

  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    reportQueryId(url)
    return originalOpen.apply(this, arguments)
  }
})()
