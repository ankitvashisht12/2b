import type { Item, Vault } from '@/lib/vault'

export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

export const fileUrl = (path: string) => '/api/file?path=' + encodeURIComponent(path)
export const sourceUrl = (vault: unknown, path: unknown) =>
  typeof vault === 'string' && typeof path === 'string' && path ? `/api/source?vault=${encodeURIComponent(vault)}&path=${encodeURIComponent(path)}` : null
/** Obsidian links artifacts as file:///…/obsidian/2bv2/… ; the dashboard opens the same file through /api/source. */
const sourceLink = (target: string) => {
  const match = /^file:\/\/\/.*?\/obsidian\/(2bv2|personal)\/(.+)$/.exec(target)
  if (!match) return null
  try { return sourceUrl(match[1] === '2bv2' ? 'legacy' : 'personal', decodeURIComponent(match[2])) } catch { return null }
}
export const itemHref = (id: string) => '#item/' + encodeURIComponent(id)

export function splitFrontmatter(body: string) {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(body || '')
  return match ? { front: match[0], text: body.slice(match[0].length) } : { front: '', text: body || '' }
}

/**
 * Reading view for Markdown. Every character of the source is escaped first; the renderer adds only
 * headings, lists, task boxes, code, quotes, rules, tables, and links. Imported HTML never runs.
 */
export function renderMarkdown(text: string, item: Item, vault: Vault): string {
  const baseDir = item.path ? item.path.split('/').slice(0, -1).join('/') : ''
  const resolvePath = (target: string) => {
    const parts = baseDir ? baseDir.split('/') : []
    for (const segment of decodeURIComponent(target.split('#')[0]).split('/')) {
      if (segment === '..') parts.pop()
      else if (segment && segment !== '.') parts.push(segment)
    }
    return parts.join('/')
  }
  const link = (label: string, target: string) => {
    if (/^https?:\/\//i.test(target)) return `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    if (/^mailto:[^\s"'<>]+@[^\s"'<>]+$/i.test(target)) return `<a href="${escapeHtml(target)}">${escapeHtml(label)}</a>`
    const source = sourceLink(target)
    if (source) return `<a href="${escapeHtml(source)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
    // Other schemes (javascript:, data:, file:) stay plain text.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return escapeHtml(label)
    let path: string
    try { path = resolvePath(target) } catch { return escapeHtml(label) }
    const linked = vault.byPath.get(path)
    if (linked) return `<a href="${itemHref(linked.id)}">${escapeHtml(label)}</a>`
    return `<a href="${fileUrl(path)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
  }
  // Bold applies inside one run of plain text, never across a link or code, so a "**" in a URL stays in the URL.
  const plain = (value: string) => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const inline = (line: string) => {
    const pattern = /!?\[([^\]]*)\]\(([^)\s]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`/g
    let html = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line))) {
      html += plain(line.slice(last, match.index))
      if (match[2] !== undefined) html += link(match[1] || match[2], match[2])
      else if (match[3] !== undefined) {
        const raw = match[3].split('#')[0].trim()
        let wikiPath = raw
        try { wikiPath = decodeURIComponent(raw) } catch { /* Literal percent signs can occur in filenames. */ }
        const byPath = vault.byPath.get(wikiPath) || vault.byPath.get(wikiPath + '.md')
        const named = vault.byName.get(raw.toLowerCase())
        const target = byPath || (named?.length === 1 ? named[0] : null)
        const label = escapeHtml(match[4] || match[3])
        html += target ? `<a href="${itemHref(target.id)}">${label}</a>` : `<span class="wiki-missing" title="Not in this vault">${label}</span>`
      } else html += `<code>${escapeHtml(match[5])}</code>`
      last = pattern.lastIndex
    }
    return html + plain(line.slice(last))
  }

  const out: string[] = []
  let paragraph: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  let code: string[] | null = null
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
    if (list) out.push(`<${list.tag}>${list.items.map(entry => `<li>${entry}</li>`).join('')}</${list.tag}>`)
    paragraph = []
    list = null
  }
  const lines = text.split('\n')
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (code) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else code.push(line)
      continue
    }
    if (/^```/.test(line)) {
      flush()
      code = []
      continue
    }
    if (line.includes('|') && lineIndex + 1 < lines.length) {
      const separators = cells(lines[lineIndex + 1])
      if (separators.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
        flush()
        const headings = cells(line)
        const rows: string[][] = []
        lineIndex += 2
        while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
          rows.push(cells(lines[lineIndex]))
          lineIndex++
        }
        lineIndex--
        out.push(`<div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${headings.map(cell => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headings.map((_heading, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
        continue
      }
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const entry = /^\s*([-*+]|\d+\.)\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(heading[1].length + 1, 4)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
    } else if (entry) {
      const tag = /\d/.test(entry[1]) ? 'ol' : 'ul'
      if (paragraph.length || (list && list.tag !== tag)) flush()
      list ??= { tag, items: [] }
      const box = entry[2] ? `<span class="task-box" role="img" data-checked="${entry[2].trim() ? 'true' : 'false'}" aria-label="${entry[2].trim() ? 'Done' : 'Not done'}"></span>` : ''
      list.items.push(box + inline(entry[3]))
    } else if (/^\s*>\s?/.test(line)) {
      flush()
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush()
      out.push('<hr>')
    } else if (!line.trim()) flush()
    else {
      if (list) flush()
      paragraph.push(line)
    }
  }
  if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  flush()
  return out.join('\n')
}
