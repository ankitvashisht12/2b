function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
}

type Destination = { url: string; title?: string; end: number };

function destinationAt(source: string, start: number): Destination | null {
  let position = start;
  let url = '';
  if (source[position] === '<') {
    const closing = source.indexOf('>', position + 1);
    if (closing < 0) return null;
    url = source.slice(position + 1, closing);
    position = closing + 1;
  } else {
    let depth = 0;
    const beginning = position;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\' && position + 1 < source.length) { position += 2; continue; }
      if (character === '(') depth++;
      if (character === ')') {
        if (depth === 0) break;
        depth--;
      }
      if (/\s/.test(character) && depth === 0) break;
      position++;
    }
    url = source.slice(beginning, position);
  }
  const hadSpace = /\s/.test(source[position] ?? '');
  while (/\s/.test(source[position] ?? '')) position++;
  let title: string | undefined;
  if (hadSpace && (source[position] === '"' || source[position] === "'")) {
    const quote = source[position++];
    const beginning = position;
    while (position < source.length && source[position] !== quote) {
      position += source[position] === '\\' ? 2 : 1;
    }
    if (position >= source.length) return null;
    title = unescapeMarkdown(source.slice(beginning, position++));
    while (/\s/.test(source[position] ?? '')) position++;
  }
  return source[position] === ')' ? { url: unescapeMarkdown(url), title, end: position + 1 } : null;
}

function safeUrl(path: string, baseUrl: string): { url: string; external: boolean } | null {
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path) || path !== path.trim()) return null;
  if (path.startsWith('//') || /&(?:#(?:x[\da-f]+|\d+);?|[a-z]+;)/i.test(path)) return null;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(path);
  if (scheme) {
    if (!/^(https?|mailto)$/i.test(scheme[1])) return null;
    return { url: path, external: /^https?$/i.test(scheme[1]) };
  }
  if (path.startsWith('#')) return { url: path, external: false };
  const url = baseUrl + path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  if (/^[\s\\]|[\u0000-\u001f\u007f\\]/.test(url) || url.startsWith('//')) return null;
  const resolvedScheme = /^([a-z][a-z\d+.-]*):/i.exec(url);
  if (resolvedScheme && !/^(https?|mailto)$/i.test(resolvedScheme[1])) return null;
  return { url, external: !!resolvedScheme && /^https?$/i.test(resolvedScheme[1]) };
}

function inline(source: string, baseUrl: string, depth = 0, allowLinks = true): string {
  if (depth > 40) return escapeHtml(source);
  const output: string[] = [];
  let position = 0;
  while (position < source.length) {
    const remaining = source.slice(position);
    const escaped = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(remaining);
    if (escaped) { output.push(escapeHtml(escaped[1])); position += escaped[0].length; continue; }
    const ticks = /^`+/.exec(remaining);
    if (ticks) {
      let closing = source.indexOf(ticks[0], position + ticks[0].length);
      while (closing >= 0 && (source[closing - 1] === '`' || source[closing + ticks[0].length] === '`')) {
        closing = source.indexOf(ticks[0], closing + ticks[0].length);
      }
      if (closing >= 0) {
        output.push(`<code>${escapeHtml(source.slice(position + ticks[0].length, closing).replace(/\n/g, ' '))}</code>`);
        position = closing + ticks[0].length;
        continue;
      }
    }
    const image = remaining.startsWith('![');
    if (image || (allowLinks && remaining.startsWith('['))) {
      const labelStart = position + (image ? 2 : 1);
      const labelEnd = source.indexOf('](', labelStart);
      if (labelEnd >= 0) {
        const destination = destinationAt(source, labelEnd + 2);
        if (destination) {
          const label = source.slice(labelStart, labelEnd);
          const safe = safeUrl(destination.url, baseUrl);
          if (safe) {
            const title = destination.title === undefined ? '' : ` title="${escapeHtml(destination.title)}"`;
            output.push(image
              ? `<img src="${escapeHtml(safe.url)}" alt="${escapeHtml(unescapeMarkdown(label))}"${title}>`
              : `<a href="${escapeHtml(safe.url)}"${title}${safe.external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${inline(label, baseUrl, depth + 1, false)}</a>`);
          } else output.push(escapeHtml(source.slice(position, destination.end)));
          position = destination.end;
          continue;
        }
      }
    }
    if (allowLinks) {
      const angle = /^<((?:https?:\/\/|mailto:)[^<>\s]+|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/i.exec(remaining);
      const bare = /^(https?:\/\/[^\s<>]+)/i.exec(remaining);
      const candidate = angle?.[1] ?? bare?.[1].replace(/[.,;:!?]+$/, '');
      if (candidate && (angle || position === 0 || /[\s(]/.test(source[position - 1]))) {
        const safe = safeUrl(candidate.includes('@') && !/^[a-z]+:/i.test(candidate) ? `mailto:${candidate}` : candidate, baseUrl);
        if (safe) {
          output.push(`<a href="${escapeHtml(safe.url)}"${safe.external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${escapeHtml(candidate)}</a>`);
          position += angle ? angle[0].length : candidate.length;
          continue;
        }
      }
    }
    let formatted = false;
    for (const [delimiter, tag] of [['***', 'strong'], ['___', 'strong'], ['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']]) {
      if (!remaining.startsWith(delimiter) || /\s/.test(remaining[delimiter.length] ?? ' ')) continue;
      if (delimiter.includes('_') && /[\p{L}\p{N}]/u.test(source[position - 1] ?? '')) continue;
      let closing = source.indexOf(delimiter, position + delimiter.length);
      if (delimiter.length === 2 && delimiter !== '~~' && closing >= 0 && source[closing + 2] === delimiter[0]) closing++;
      if (closing < 0 || /\s/.test(source[closing - 1])) continue;
      const content = inline(source.slice(position + delimiter.length, closing), baseUrl, depth + 1, allowLinks);
      output.push(delimiter.length === 3 ? `<strong><em>${content}</em></strong>` : `<${tag}>${content}</${tag}>`);
      position = closing + delimiter.length;
      formatted = true;
      break;
    }
    if (formatted) continue;
    if (source[position] === '\n') {
      output.push('<br>');
    } else output.push(escapeHtml(source[position]));
    position++;
  }
  return output.join('');
}

const listPattern = /^( *)([-+*]|\d+[.)])\s+(.*)$/;
const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function tableCells(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|') && !content.endsWith('\\|')) content = content.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let ticks = 0;
  for (let position = 0; position < content.length; position++) {
    const character = content[position];
    if (character === '\\' && position + 1 < content.length) { current += character + content[++position]; continue; }
    if (character === '`') {
      const run = /^`+/.exec(content.slice(position))![0];
      ticks = ticks === run.length ? 0 : ticks === 0 ? run.length : ticks;
      current += run;
      position += run.length - 1;
    } else if (character === '|' && !ticks) { cells.push(current.trim()); current = ''; }
    else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function tableAlignment(line: string): string[] | null {
  const cells = tableCells(line);
  return cells.every(cell => /^:?-{3,}:?$/.test(cell))
    ? cells.map(cell => cell.startsWith(':') ? (cell.endsWith(':') ? 'center' : 'left') : cell.endsWith(':') ? 'right' : '')
    : null;
}

function blocks(lines: string[], baseUrl: string, slugs: Set<string>, depth = 0): string {
  if (depth > 40) return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
  const output: string[] = [];
  let position = 0;
  function startsBlock(index: number): boolean {
    const line = lines[index] ?? '';
    return !line.trim() || /^ {0,3}#{1,6}\s/.test(line) || fencePattern.test(line) || /^ {0,3}>/.test(line) || rulePattern.test(line) || listPattern.test(line)
      || (line.includes('|') && !!lines[index + 1] && !!tableAlignment(lines[index + 1]));
  }
  while (position < lines.length) {
    const line = lines[position];
    if (!line.trim()) { position++; continue; }
    const fence = fencePattern.exec(line);
    if (fence) {
      const code: string[] = [];
      position++;
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (position < lines.length && !closing.test(lines[position])) code.push(lines[position++]);
      if (position < lines.length) position++;
      const language = fence[2].trim();
      const attribute = /^[\w+-]+$/.test(language) ? ` class="language-${escapeHtml(language)}"` : '';
      output.push(`<pre><code${attribute}>${escapeHtml(code.join('\n') + (code.length ? '\n' : ''))}</code></pre>`);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const slugBase = unescapeMarkdown(heading[2]).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      let slug = slugBase;
      let suffix = 2;
      while (slugs.has(slug)) slug = `${slugBase}-${suffix++}`;
      slugs.add(slug);
      output.push(`<h${heading[1].length} id="${escapeHtml(slug)}">${inline(heading[2], baseUrl)}</h${heading[1].length}>`);
      position++;
      continue;
    }
    if (rulePattern.test(line)) { output.push('<hr>'); position++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (position < lines.length && /^ {0,3}>/.test(lines[position])) quote.push(lines[position++].replace(/^ {0,3}> ?/, ''));
      output.push(`<blockquote>\n${blocks(quote, baseUrl, slugs, depth + 1)}\n</blockquote>`);
      continue;
    }
    const list = listPattern.exec(line);
    if (list) {
      const indentation = list[1].length;
      const ordered = /^\d/.test(list[2]);
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && Number.parseInt(list[2]) !== 1 ? ` start="${Number.parseInt(list[2])}"` : '';
      const items: string[] = [];
      while (position < lines.length) {
        const item = listPattern.exec(lines[position]);
        if (!item || item[1].length !== indentation || /^\d/.test(item[2]) !== ordered || rulePattern.test(lines[position])) break;
        const contentIndent = item[1].length + item[2].length + 1;
        const itemLines = [item[3]];
        position++;
        while (position < lines.length) {
          if (!lines[position].trim()) {
            if (lines[position + 1] && /^\s/.test(lines[position + 1]) && lines[position + 1].search(/\S/) > indentation) { itemLines.push(''); position++; continue; }
            break;
          }
          const spaces = lines[position].search(/\S/);
          if (spaces <= indentation) break;
          itemLines.push(lines[position++].slice(Math.min(contentIndent, spaces)));
        }
        const task = /^\[([ xX])\]\s+(.*)$/.exec(itemLines[0]);
        if (task) itemLines[0] = task[2];
        let content = blocks(itemLines, baseUrl, slugs, depth + 1).replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        if (task) content = `<input type="checkbox" disabled="disabled"${task[1].toLowerCase() === 'x' ? ' checked="checked"' : ''}> ${content}`;
        items.push(`<li>${content}</li>`);
      }
      output.push(`<${tag}${start}>\n${items.join('\n')}\n</${tag}>`);
      continue;
    }
    const alignments = lines[position + 1] && line.includes('|') ? tableAlignment(lines[position + 1]) : null;
    if (alignments && tableCells(line).length === alignments.length) {
      const row = (cells: string[], tag: string) => `<tr>${alignments.map((alignment, index) => `<${tag}${alignment ? ` style="text-align:${alignment}"` : ''}>${inline(cells[index] ?? '', baseUrl)}</${tag}>`).join('')}</tr>`;
      const header = row(tableCells(line), 'th');
      position += 2;
      const rows: string[] = [];
      while (position < lines.length && lines[position].trim() && lines[position].includes('|')) rows.push(row(tableCells(lines[position++]), 'td'));
      output.push(`<table>\n<thead>${header}</thead>\n<tbody>${rows.join('\n')}</tbody>\n</table>`);
      continue;
    }
    const paragraph = [line];
    position++;
    while (position < lines.length && !startsBlock(position)) paragraph.push(lines[position++]);
    output.push(`<p>${inline(paragraph.join('\n').replace(/ {2,}\n/g, '\n'), baseUrl)}</p>`);
  }
  return output.join('\n');
}

export function renderMarkdown(source: string, options: { baseUrl?: string } = {}): string {
  try {
    const { baseUrl = '' } = options;
    if (typeof source !== 'string' || typeof baseUrl !== 'string') throw new TypeError('Expected text');
    const lines = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
    if (lines[0] === '---') {
      const closing = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)$/.test(line));
      if (closing > 0) lines.splice(0, closing + 1);
    }
    return blocks(lines, baseUrl, new Set());
  } catch {
    return `<pre>${escapeHtml(typeof source === 'string' ? source : '')}</pre>`;
  }
}
