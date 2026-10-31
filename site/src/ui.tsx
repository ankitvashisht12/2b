import { useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, Copy } from 'lucide-react'

export const repo = 'https://github.com/ankitvashisht12/2b'

export function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function SiteHeader({ current }: { current?: 'v1' | 'v2' | 'v3' }) {
  return (
    <header className="page site-header">
      <a className="wordmark" href="/">
        <strong>2b</strong>
        <span>your second brain</span>
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href="/#install">Install</a>
        <a className="optional" href="/#versions" aria-current={current ? 'page' : undefined}>
          Versions
        </a>
        <a href={repo}>
          <GitHubMark />
          GitHub
        </a>
      </nav>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page">
        <p>2b is a personal project by Ankit Vashisht. It runs on your own Mac.</p>
        <nav aria-label="Footer">
          <a href="/">Home</a>
          <a href="/v3/">v3</a>
          <a href="/v2/">v2</a>
          <a href="/v1/">v1</a>
          <a href={repo}>Source on GitHub</a>
          <a href={`${repo}/issues`}>Report a problem</a>
        </nav>
      </div>
    </footer>
  )
}

/** One line on the page spine: a label in the gutter, a mark on the rule, and the content. */
export function Entry({
  label,
  mark = 'dot',
  className,
  children,
}: {
  label?: ReactNode
  mark?: 'dot' | 'strong' | ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className ? `entry ${className}` : 'entry'}>
      <div className="entry-label">{label}</div>
      <div className="entry-mark" data-strong={mark === 'strong' || undefined} aria-hidden="true">
        {mark === 'dot' || mark === 'strong' ? <span /> : mark}
      </div>
      <div className="entry-body">{children}</div>
    </div>
  )
}

/** A heading that starts a section, with the strong mark on the rule. */
export function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <Entry mark="strong" className="section-head">
      <h2 id={id}>{title}</h2>
      {children && <p className="lede">{children}</p>}
    </Entry>
  )
}

/** Shell commands with a Copy button. A line that starts with "#", or text after "  # ", shows as a comment. */
export function Command({ code, label, primary }: { code: string; label: string; primary?: boolean }) {
  const codeRef = useRef<HTMLElement>(null)
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setState('copied')
    } catch {
      // Clipboard access can be blocked; select the text so ⌘C still works.
      const range = document.createRange()
      range.selectNodeContents(codeRef.current!)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
      setState('selected')
    }
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="command" data-primary={primary || undefined}>
      <pre>
        <code ref={codeRef}>
          {code.split('\n').map((line, lineNumber) => {
            const commentStart = line.startsWith('#') ? 0 : line.indexOf('  # ')
            return (
              <span key={lineNumber}>
                {commentStart < 0 ? line : line.slice(0, commentStart)}
                {commentStart >= 0 && <span className="comment">{line.slice(commentStart)}</span>}
              </span>
            )
          })}
        </code>
      </pre>
      <button type="button" className="copy-button" data-copied={state === 'copied' || undefined} onClick={copy} aria-label={`Copy: ${label}`}>
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === 'copied' ? 'Copied' : state === 'selected' ? 'Press ⌘C' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to the clipboard.' : state === 'selected' ? 'Text selected. Press Command C to copy.' : ''}
      </span>
    </div>
  )
}

export function VersionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="button" href={href}>
      {children}
      <ArrowRight aria-hidden="true" />
    </a>
  )
}
