import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownBlockProps {
  text: string
}

function MarkdownBlock({ text }: MarkdownBlockProps): React.JSX.Element {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => {
            // eslint-disable-next-line react/prop-types
            const { href, children } = props
            const external = Boolean(href && /^https?:/i.test(href))
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault()
                  if (external && href) {
                    void window.api.openExternal(href).catch(() => undefined)
                  }
                }}
              >
                {children}
              </a>
            )
          },
          /* eslint-disable react/prop-types */
          img: (props) => {
            const src = props.src
            const alt = props.alt
            if (typeof src === 'string' && src.startsWith('data:image/')) {
              return <img src={src} alt={alt ?? ''} loading="lazy" />
            }
            return alt ? <span className="text-caption text-subtle">{alt}</span> : null
          }
          /* eslint-enable react/prop-types */
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownBlock
