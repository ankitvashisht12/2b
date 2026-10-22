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

type InlineToken = {
  start: number;
  end: number;
  html?: string;
  marker?: string;
  remaining?: number;
  opening?: string[];
  closing?: string[];
};

function scanInlineSyntax(source: string, allowLinks: boolean): {
  protectedSpans: Map<number, InlineToken>;
  closingBrackets: Map<number, number>;
  destinations: Map<number, Destination>;
} {
  const tickRuns = new Map<number, { starts: number[]; cursor: number }>();
  for (let position = 0; position < source.length;) {
    if (source[position] !== '`') { position++; continue; }
    const start = position;
    while (source[position] === '`') position++;
    const length = position - start;
    const runs = tickRuns.get(length) ?? { starts: [], cursor: 0 };
    runs.starts.push(start);
    tickRuns.set(length, runs);
  }
  const tokens = new Map<number, InlineToken>();
  const brackets: number[] = [];
  const closingBrackets = new Map<number, number>();
  const destinations = new Map<number, Destination>();
  let position = 0;
  while (position < source.length) {
    const start = position;
    const character = source[position];
    if (character === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[position + 1] ?? '')) {
      tokens.set(start, { start, end: position + 2, html: escapeHtml(source[position + 1]) });
      position += 2;
      continue;
    }
    if (character === '`') {
      while (source[position] === '`') position++;
      const length = position - start;
      const runs = tickRuns.get(length);
      if (runs) {
        while (runs.cursor < runs.starts.length && runs.starts[runs.cursor] < position) runs.cursor++;
        const closing = runs.starts[runs.cursor];
        if (closing !== undefined) {
          tokens.set(start, { start, end: closing + length, html: `<code>${escapeHtml(source.slice(position, closing).replace(/\n/g, ' '))}</code>` });
          position = closing + length;
          continue;
        }
      }
      tokens.set(start, { start, end: position });
      continue;
    }
    if (character === '[') brackets.push(position);
    else if (character === ']' && brackets.length) {
      const labelStart = brackets.pop()!;
      closingBrackets.set(labelStart, position);
      const image = source[labelStart - 1] === '!' && tokens.get(labelStart - 2)?.end !== labelStart;
      if ((allowLinks || image) && source[position + 1] === '(') {
        const destination = destinationAt(source, position + 2);
        if (destination) {
          destinations.set(labelStart, destination);
          position = destination.end;
          continue;
        }
      }
    }
    position++;
  }
  return { protectedSpans: tokens, closingBrackets, destinations };
}

function inlineTokens(source: string, baseUrl: string, depth: number, allowLinks: boolean): InlineToken[] {
  const { protectedSpans, closingBrackets, destinations } = scanInlineSyntax(source, allowLinks);
  const tokens: InlineToken[] = [];
  let position = 0;
  while (position < source.length) {
    const start = position;
    const character = source[position];
    const protectedSpan = protectedSpans.get(position);
    if (protectedSpan) {
      tokens.push(protectedSpan);
      position = protectedSpan.end;
      continue;
    }
    const image = source.startsWith('![', position);
    const labelStart = position + (image ? 1 : 0);
    const labelEnd = closingBrackets.get(labelStart);
    if ((image || allowLinks) && labelEnd !== undefined && source[labelEnd + 1] === '(') {
      const destination = destinations.get(labelStart);
      if (destination) {
        const label = source.slice(labelStart + 1, labelEnd);
        const safe = safeUrl(destination.url, baseUrl);
        let html = escapeHtml(source.slice(start, destination.end));
        if (safe) {
          const title = destination.title === undefined ? '' : ` title="${escapeHtml(destination.title)}"`;
          html = image
            ? `<img src="${escapeHtml(safe.url)}" alt="${escapeHtml(unescapeMarkdown(label))}"${title}>`
            : `<a href="${escapeHtml(safe.url)}"${title}${safe.external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${inline(label, baseUrl, depth + 1, false)}</a>`;
        }
        position = destination.end;
        tokens.push({ start, end: position, html });
        continue;
      }
    }
    if (allowLinks && (character === '<' || ((position === 0 || /[\s(]/.test(source[position - 1])) && /^https?:\/\//i.test(source.slice(position, position + 8))))) {
      const angle = character === '<';
      let end = position + (angle ? 1 : 0);
      while (end < source.length && !/[<>\s]/.test(source[end])) end++;
      let candidate = source.slice(position + (angle ? 1 : 0), end);
      const at = candidate.indexOf('@');
      const dot = candidate.lastIndexOf('.');
      const email = at > 0 && at === candidate.lastIndexOf('@') && dot > at && dot < candidate.length - 1;
      if ((!angle || source[end] === '>') && (/^(?:https?:\/\/|mailto:)/i.test(candidate) || (angle && email))) {
        if (!angle) candidate = candidate.replace(/[.,;:!?]+$/, '');
        const safe = safeUrl(email && !/^[a-z]+:/i.test(candidate) ? `mailto:${candidate}` : candidate, baseUrl);
        if (safe) {
          position = angle ? end + 1 : start + candidate.length;
          tokens.push({ start, end: position, html: `<a href="${escapeHtml(safe.url)}"${safe.external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${escapeHtml(candidate)}</a>` });
          continue;
        }
      }
    }
    if (character === '*' || character === '_' || character === '~') {
      while (source[position] === character) position++;
      tokens.push({ start, end: position, marker: character, remaining: position - start, opening: [], closing: [] });
      continue;
    }
    if (character === '\n') {
      tokens.push({ start, end: ++position, html: '<br>' });
      continue;
    }
    position++;
    if (!/[\[\]!<\\]/.test(character)) {
      while (position < source.length && !/[`\\[\]!*_~<\nhH]/.test(source[position])) position++;
    }
    tokens.push({ start, end: position });
  }
  return tokens;
}

function formatTokens(tokens: InlineToken[], source: string): string {
  const openers: InlineToken[] = [];
  const markerOpeners = new Map<string, InlineToken[]>();
  function removeOpener(): void {
    const opener = openers.pop()!;
    markerOpeners.get(opener.marker!)!.pop();
  }
  for (const token of tokens) {
    if (!token.marker) continue;
    const marker = token.marker;
    const previous = source[token.start - 1] ?? ' ';
    const next = source[token.end] ?? ' ';
    const canOpen = !/\s/.test(next) && (marker !== '_' || !/[\p{L}\p{N}]/u.test(previous));
    const canClose = !/\s/.test(previous) && (marker !== '_' || !/[\p{L}\p{N}]/u.test(next));
    const matching = markerOpeners.get(marker) ?? [];
    markerOpeners.set(marker, matching);
    if (canClose) {
      while (token.remaining! >= (marker === '~' ? 2 : 1) && matching.length) {
        const opener = matching[matching.length - 1];
        while (openers[openers.length - 1] !== opener) removeOpener();
        const available = Math.min(opener.remaining!, token.remaining!);
        const count = marker === '~' ? 2 : Math.min(available, 3);
        const opening = marker === '~' ? '<del>' : count === 3 ? '<strong><em>' : count === 2 ? '<strong>' : '<em>';
        const closing = marker === '~' ? '</del>' : count === 3 ? '</em></strong>' : count === 2 ? '</strong>' : '</em>';
        opener.opening!.push(opening);
        token.closing!.push(closing);
        opener.remaining! -= count;
        token.remaining! -= count;
        if (opener.remaining! < (marker === '~' ? 2 : 1)) removeOpener();
      }
    }
    if (canOpen && token.remaining! >= (marker === '~' ? 2 : 1)) {
      openers.push(token);
      matching.push(token);
    }
  }
  return tokens.map(token => token.html ?? (token.marker
    ? token.closing!.join('') + token.marker.repeat(token.remaining!) + token.opening!.reverse().join('')
    : escapeHtml(source.slice(token.start, token.end)))).join('');
}

function inline(source: string, baseUrl: string, depth = 0, allowLinks = true): string {
  if (depth > 40) return escapeHtml(source);
  return formatTokens(inlineTokens(source, baseUrl, depth, allowLinks), source);
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

function headingAt(line: string): { level: number; content: string } | null {
  let position = 0;
  while (position < 3 && line[position] === ' ') position++;
  const prefix = position;
  while (line[position] === '#' && position - prefix < 7) position++;
  const level = position - prefix;
  if (level < 1 || level > 6 || !/\s/.test(line[position] ?? '')) return null;
  while (position < line.length && /\s/.test(line[position])) position++;
  let end = line.length;
  while (end > position && /\s/.test(line[end - 1])) end--;
  let closing = end;
  while (closing > position && line[closing - 1] === '#') closing--;
  if (closing < end && (closing === position || /\s/.test(line[closing - 1]))) end = closing;
  while (end > position && /\s/.test(line[end - 1])) end--;
  return { level, content: line.slice(position, end) };
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
    const heading = headingAt(line);
    if (heading) {
      const slugBase = unescapeMarkdown(heading.content).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      let slug = slugBase;
      let suffix = 2;
      while (slugs.has(slug)) slug = `${slugBase}-${suffix++}`;
      slugs.add(slug);
      output.push(`<h${heading.level} id="${escapeHtml(slug)}">${inline(heading.content, baseUrl)}</h${heading.level}>`);
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
