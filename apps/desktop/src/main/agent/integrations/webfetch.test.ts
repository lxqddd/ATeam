import { describe, expect, it, vi } from 'vitest'
import {
  fetchWebContent,
  formatWebFetchResult,
  htmlToMarkdown,
  htmlToText,
  normalizeWebUrl
} from './webfetch'

describe('normalizeWebUrl', () => {
  it('accepts http and https URLs and strips fragments', () => {
    expect(normalizeWebUrl('https://example.com/a?x=1#top')).toBe('https://example.com/a?x=1')
    expect(normalizeWebUrl(' http://example.com ')).toBe('http://example.com/')
  })

  it('rejects non-web protocols and invalid input', () => {
    expect(() => normalizeWebUrl('file:///etc/passwd')).toThrow('http(s)')
    expect(() => normalizeWebUrl('javascript:alert(1)')).toThrow('http(s)')
    expect(() => normalizeWebUrl('not a url')).toThrow('valid URL')
  })
})

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis and links', () => {
    const markdown = htmlToMarkdown(
      '<h1>Title</h1><p>Hello <strong>world</strong> and <a href="https://example.com">link</a></p>'
    )

    expect(markdown).toContain('# Title')
    expect(markdown).toContain('**world**')
    expect(markdown).toContain('[link](https://example.com)')
  })

  it('drops scripts and styles', () => {
    const markdown = htmlToMarkdown(
      '<style>.a{color:red}</style><script>alert(1)</script><p>Visible</p>'
    )

    expect(markdown).toBe('Visible')
  })

  it('converts lists and code blocks', () => {
    const markdown = htmlToMarkdown(
      '<ul><li>one</li><li>two</li></ul><pre><code>const a = 1</code></pre>'
    )

    expect(markdown).toMatch(/[-*]\s+one/)
    expect(markdown).toContain('const a = 1')
    expect(markdown).not.toContain('<li>')
  })
})

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    const text = htmlToText(
      '<style>.a{}</style><p>Hello&nbsp;<b>world</b> &amp; <i>friends</i></p><p>Second line</p>'
    )

    expect(text).toBe('Hello world & friends\n\nSecond line')
  })

  it('removes scripts', () => {
    expect(htmlToText('<script>alert(1)</script><p>Keep</p>')).toBe('Keep')
  })
})

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init
  })
}

describe('fetchWebContent', () => {
  it('fetches HTML and converts it to markdown', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => htmlResponse('<h1>Hi</h1><p>Body</p>'))

    const result = await fetchWebContent(
      { url: 'https://example.com/page', format: 'markdown' },
      { fetch: fetchMock }
    )

    expect(result).toMatchObject({
      url: 'https://example.com/page',
      status: 200,
      format: 'markdown'
    })
    expect(result.contentType).toContain('text/html')
    expect(result.content).toContain('# Hi')
    expect(result.content).toContain('Body')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({
        redirect: 'follow',
        headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('ATeam') })
      })
    )
  })

  it('returns plain text for non-HTML responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    const result = await fetchWebContent(
      { url: 'https://example.com/api', format: 'markdown' },
      { fetch: fetchMock }
    )

    expect(result.content).toBe('{"ok":true}')
    expect(result.format).toBe('text')
  })

  it('supports the html and text formats', async () => {
    const html = '<h1>Hi</h1><script>x</script><i>there</i>'
    const htmlFetch = vi.fn<typeof fetch>(async () => htmlResponse(html))
    const textFetch = vi.fn<typeof fetch>(async () => htmlResponse(html))

    const raw = await fetchWebContent(
      { url: 'https://example.com', format: 'html' },
      { fetch: htmlFetch }
    )
    expect(raw.content).toContain('<h1>Hi</h1>')

    const text = await fetchWebContent(
      { url: 'https://example.com', format: 'text' },
      { fetch: textFetch }
    )
    expect(text.content).toBe('Hi\n\nthere')
  })

  it('reports the final URL after redirects', async () => {
    const response = htmlResponse('<p>moved</p>')
    Object.defineProperty(response, 'url', { value: 'https://example.com/final' })
    const fetchMock = vi.fn<typeof fetch>(async () => response)

    const result = await fetchWebContent({ url: 'https://example.com/start' }, { fetch: fetchMock })

    expect(result.url).toBe('https://example.com/final')
  })

  it('rejects HTTP errors with a body preview', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' })
    )

    await expect(
      fetchWebContent({ url: 'https://example.com/missing' }, { fetch: fetchMock })
    ).rejects.toThrow('HTTP 404 Not Found: not found')
  })

  it('times out slow requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )

    await expect(
      fetchWebContent({ url: 'https://example.com', timeoutMs: 10 }, { fetch: fetchMock })
    ).rejects.toThrow('timed out')
  })

  it('truncates oversized responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('x'.repeat(100), {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        })
    )

    const result = await fetchWebContent(
      { url: 'https://example.com' },
      { fetch: fetchMock, maxBytes: 20 }
    )

    expect(result.content).toBe('x'.repeat(20) + '\n[content truncated at 20 characters]')
  })
})

describe('formatWebFetchResult', () => {
  it('prefixes the content with request metadata', () => {
    expect(
      formatWebFetchResult({
        url: 'https://example.com/page',
        status: 200,
        contentType: 'text/html',
        format: 'markdown',
        content: '# Hi'
      })
    ).toBe('URL: https://example.com/page\nStatus: 200\nContent-Type: text/html\n\n# Hi')
  })
})
