export interface BrowserElement {
  ref: string
  role: string
  name: string
  value?: string
}

export interface BrowserSnapshot {
  title: string
  url: string
  text: string
  elements: BrowserElement[]
}

const MAX_EVAL_OUTPUT = 20_000

export function validateBrowserUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
    return trimmed
  } catch {
    throw new Error('INVALID_URL')
  }
}

function assertRef(ref: string): string {
  if (!/^\d{1,6}$/.test(ref)) throw new Error('INVALID_REF')
  return ref
}

export function snapshotScript(): string {
  return `(() => {
  const selector = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"],[onclick]'
  const describe = (el) => {
    const role = el.getAttribute('role') || el.tagName.toLowerCase()
    const rawName = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('alt') || ''
    const name = String(rawName).replace(/\\s+/g, ' ').trim().slice(0, 80)
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    return { role, name, ...(isField ? { value: String(el.value).slice(0, 80) } : {}) }
  }
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const nodes = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 120)
  const elements = nodes.map((el, index) => {
    const ref = String(index + 1)
    el.setAttribute('data-ateam-ref', ref)
    return { ref, ...describe(el) }
  })
  return {
    title: document.title,
    url: location.href,
    text: String(document.body ? document.body.innerText : '').slice(0, 4000),
    elements
  }
})()`
}

export function clickScript(ref: string): string {
  return `(() => {
  const el = document.querySelector('[data-ateam-ref="${assertRef(ref)}"]')
  if (!el) return { ok: false, error: 'Element not found; take a new snapshot.' }
  el.scrollIntoView({ block: 'center' })
  el.click()
  return { ok: true, title: document.title, url: location.href }
})()`
}

export function typeScript(ref: string, text: string, submit: boolean): string {
  return `(() => {
  const el = document.querySelector('[data-ateam-ref="${assertRef(ref)}"]')
  if (!el) return { ok: false, error: 'Element not found; take a new snapshot.' }
  el.focus()
  const value = ${JSON.stringify(text)}
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (${submit ? 'true' : 'false'}) {
    if (el.form && el.form.requestSubmit) el.form.requestSubmit()
    else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }
  return { ok: true, title: document.title, url: location.href }
})()`
}

export function formatSnapshot(snapshot: BrowserSnapshot, consoleLines: string[] = []): string {
  const elements = snapshot.elements.map((element) => {
    const value = element.value !== undefined ? ` value=${JSON.stringify(element.value)}` : ''
    return `[${element.ref}] ${element.role} ${JSON.stringify(element.name)}${value}`
  })
  const sections = [
    `Page: ${snapshot.title || '(untitled)'}`,
    `URL: ${snapshot.url}`,
    elements.length > 0
      ? `Interactive elements:\n${elements.join('\n')}`
      : 'No interactive elements.',
    `Page text:\n${snapshot.text.trim() || '(empty)'}`
  ]
  if (consoleLines.length > 0) {
    sections.push(`Console:\n${consoleLines.slice(-20).join('\n')}`)
  }
  return sections.join('\n\n')
}

export function evalResult(value: unknown): string {
  let text: string
  if (value === undefined) text = 'undefined'
  else if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length <= MAX_EVAL_OUTPUT) return text
  return `${text.slice(0, MAX_EVAL_OUTPUT)}\n[output truncated]`
}
