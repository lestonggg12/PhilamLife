// Reload at most once per entry bundle in this tab. If storage is blocked,
// let the error boundary offer a manual reload instead of risking a loop.
export function recoverPreloadError(browser, entryUrl) {
  if (browser.navigator.onLine === false) return false

  try {
    const key = `philamlife:preload-reload:${entryUrl}`
    if (browser.sessionStorage.getItem(key)) return false
    browser.sessionStorage.setItem(key, '1')
  } catch {
    return false
  }

  browser.location.reload()
  return true
}
