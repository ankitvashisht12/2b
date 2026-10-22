import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.ts';

test('ATX headings have stable unique slugs at all six levels', () => {
  const html = renderMarkdown('# Hello, world!\n## Hello, world!\n### Three\n#### Four\n##### Five\n###### Six');
  assert.match(html, /<h1 id="hello-world">Hello, world!<\/h1>/);
  assert.match(html, /<h2 id="hello-world-2">/);
  for (const level of [3, 4, 5, 6]) assert.match(html, new RegExp(`<h${level} id="`));
});
test('paragraphs and line breaks', () => {
  assert.equal(renderMarkdown('first\nsecond\n\nthird'), '<p>first<br>second</p>\n<p>third</p>');
});
test('emphasis, strong, strike, and nested inline formatting', () => {
  assert.equal(renderMarkdown('*one* _two_ **three** __four__ ~~five~~ **bold *inner***'), '<p><em>one</em> <em>two</em> <strong>three</strong> <strong>four</strong> <del>five</del> <strong>bold <em>inner</em></strong></p>');
});
test('inline code is literal and escaped, including multiple backticks', () => {
  assert.equal(renderMarkdown('`<b>*x*</b>` and ``a ` b``'), '<p><code>&lt;b&gt;*x*&lt;/b&gt;</code> and <code>a ` b</code></p>');
});
test('fenced code preserves markdown and HTML and escapes language attributes', () => {
  assert.equal(renderMarkdown('```ts\n<script>*x*</script>\n```'), '<pre><code class="language-ts">&lt;script&gt;*x*&lt;/script&gt;\n</code></pre>');
  assert.doesNotMatch(renderMarkdown('```x" onclick="bad\nx\n```'), /class="language-x"/);
  assert.match(renderMarkdown('```\nunclosed'), /<pre><code>unclosed\n<\/code><\/pre>/);
});
test('blockquotes can contain blocks and nested quotes', () => {
  assert.equal(renderMarkdown('> quote\n>\n> > deep'), '<blockquote>\n<p>quote</p>\n<blockquote>\n<p>deep</p>\n</blockquote>\n</blockquote>');
});
test('unordered, ordered, and nested mixed lists', () => {
  assert.equal(renderMarkdown('- outer\n  1. inner\n  2. next\n- last'), '<ul>\n<li>outer\n<ol>\n<li>inner</li>\n<li>next</li>\n</ol></li>\n<li>last</li>\n</ul>');
  assert.match(renderMarkdown('3. third\n4. fourth'), /<ol start="3">/);
});
test('task lists use disabled checkboxes', () => {
  assert.equal(renderMarkdown('- [ ] open\n- [x] done\n- [X] also'), '<ul>\n<li><input type="checkbox" disabled="disabled"> open</li>\n<li><input type="checkbox" disabled="disabled" checked="checked"> done</li>\n<li><input type="checkbox" disabled="disabled" checked="checked"> also</li>\n</ul>');
});
test('tables have alignment, inline content, and escaped pipes', () => {
  const html = renderMarkdown('| Left | Center | Right |\n| :--- | :---: | ---: |\n| **a** | b\\|c | `<x>` |');
  assert.match(html, /<th style="text-align:left">Left<\/th>/);
  assert.match(html, /<th style="text-align:center">Center<\/th>/);
  assert.match(html, /<td style="text-align:right"><code>&lt;x&gt;<\/code><\/td>/);
  assert.match(html, /b\|c/);
});
test('horizontal rules', () => {
  assert.equal(renderMarkdown('---\n\n***\n\n___'), '<hr>\n<hr>\n<hr>');
});
test('links, titles, images, anchors, mail, and relative encoding', () => {
  const html = renderMarkdown('[web](https://example.com "A & B") [mail](mailto:a@example.com) [part](#hello) [file](<notes/a b.md>) ![A & B](images/a.png "pic")', { baseUrl: '/api/file?path=dir/' });
  assert.match(html, /href="https:\/\/example.com" title="A &amp; B" rel="noopener noreferrer" target="_blank"/);
  assert.match(html, /href="mailto:a@example.com"/);
  assert.match(html, /href="#hello"/);
  assert.match(html, /href="\/api\/file\?path=dir\/notes\/a%20b.md"/);
  assert.match(html, /<img src="\/api\/file\?path=dir\/images\/a.png" alt="A &amp; B" title="pic">/);
});
test('angle and bare URL autolinks', () => {
  const html = renderMarkdown('<https://example.com> <a@example.com> https://example.com/path.');
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.match(html, /href="mailto:a@example.com"/);
  assert.match(html, /<\/a>\.<\/p>$/);
});
test('frontmatter is stripped only when closed at the start', () => {
  assert.equal(renderMarkdown('---\ntitle: secret\n---\n# Visible'), '<h1 id="visible">Visible</h1>');
  assert.match(renderMarkdown('---\nnot closed'), /not closed/);
});
test('raw HTML is always text', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;img src=x onerror=alert(1)&gt;</p>');
});
for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,bad', 'vbscript:bad', '//evil.test/a', '\\evil.test', 'java\tscript:bad', 'javascript&#58;bad']) {
  test(`rejects unsafe link and image URL ${JSON.stringify(url)}`, () => {
    const html = renderMarkdown(`[bad](<${url}>) ![bad](<${url}>)`);
    assert.doesNotMatch(html, /<(?:a|img)\b/);
  });
}
test('quotes in URL, title, alt and heading cannot add attributes', () => {
  const html = renderMarkdown('[x](<https://example.com/"onmouseover="bad> "a\\" onclick=\\"bad") ![" onerror="bad](safe.png)\n\n# " onclick="bad');
  assert.match(html, /href="https:\/\/example.com\/&quot;onmouseover=&quot;bad"/);
  assert.match(html, /title="a&quot; onclick=&quot;bad"/);
  assert.match(html, /alt="&quot; onerror=&quot;bad"/);
  assert.doesNotMatch(html, /<[^>]+\s(?:onerror|onclick|onmouseover)="/);
});
test('encoded schemes and entity tricks remain inert relative paths', () => {
  const html = renderMarkdown('[x](javascript%3Aalert) [y](&#106;avascript:bad)');
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /href="&#/);
});
test('balanced parentheses in URLs and escaped Markdown', () => {
  assert.match(renderMarkdown('[wiki](https://example.com/a_(b))'), /href="https:\/\/example.com\/a_\(b\)"/);
  assert.equal(renderMarkdown('\\*literal\\* & < > "'), '<p>*literal* &amp; &lt; &gt; &quot;</p>');
});
test('empty, CRLF, malformed syntax, and unexpected input do not throw', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown('one\r\ntwo'), '<p>one<br>two</p>');
  assert.doesNotThrow(() => renderMarkdown('['.repeat(10000)));
  assert.equal(renderMarkdown(null as unknown as string), '<pre></pre>');
});
test('an unsafe base URL cannot turn relative paths into executable URLs', () => {
  assert.doesNotMatch(renderMarkdown('[x](file.md) ![x](image.png)', { baseUrl: 'javascript:' }), /<(?:a|img)\b/);
  assert.doesNotMatch(renderMarkdown('[x](file.md)', { baseUrl: '//evil.test/' }), /<a\b/);
  assert.match(renderMarkdown('[x](file.md)', { baseUrl: 'https://example.com/' }), /rel="noopener noreferrer" target="_blank"/);
});
test('invalid options use the escaped fallback without throwing', () => {
  assert.equal(renderMarkdown('<script>', null as unknown as { baseUrl?: string }), '<pre>&lt;script&gt;</pre>');
});
test('ordinary query strings, Unicode paths, and malicious titles remain safe', () => {
  assert.match(renderMarkdown('[x](https://example.com/?a=1&b=2)'), /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(renderMarkdown('[x](<notes/日本語 a.md>)'), /href="notes\/%E6%97%A5%E6%9C%AC%E8%AA%9E%20a.md"/);
  assert.match(renderMarkdown('![x](image.png "<img onerror=bad>")'), /title="&lt;img onerror=bad&gt;"/);
});

test('closing delimiters respect nested emphasis, code spans, and escapes', () => {
  assert.equal(renderMarkdown('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>');
  assert.equal(renderMarkdown('**a `b**c` d**'), '<p><strong>a <code>b**c</code> d</strong></p>');
  assert.equal(renderMarkdown('*a \\* b*'), '<p><em>a * b</em></p>');
  assert.equal(renderMarkdown('***both***'), '<p><strong><em>both</em></strong></p>');
});
test('link labels respect code spans, escaped brackets, and balanced brackets', () => {
  assert.equal(renderMarkdown('[`a](b)`](safe)'), '<p><a href="safe"><code>a](b)</code></a></p>');
  assert.equal(renderMarkdown('[a [b] c](safe)'), '<p><a href="safe">a [b] c</a></p>');
  assert.equal(renderMarkdown('[a \\] b](safe)'), '<p><a href="safe">a ] b</a></p>');
});

const performanceCases = [
  { name: 'heading with 3,200 spaces', source: '# a' + ' '.repeat(3200) + 'x', expected: '<h1 id="a-x">a' + ' '.repeat(3200) + 'x</h1>' },
  { name: 'email with 40,000 dots', source: '<a@' + '.'.repeat(40000) + ' ', expected: '<p>&lt;a@' + '.'.repeat(40000) + ' </p>' },
  { name: '80,000 unmatched backticks', source: '`'.repeat(80000), expected: '<pre><code></code></pre>' },
  { name: '50,000 opening brackets', source: '['.repeat(50000), expected: '<p>' + '['.repeat(50000) + '</p>' },
  { name: '50,000 stars', source: '*'.repeat(50000), expected: '<hr>' },
  { name: '10,000-line list', source: Array.from({ length: 10000 }, (_, itemNumber) => '- item ' + itemNumber).join('\n'), expected: '<ul>\n' + Array.from({ length: 10000 }, (_, itemNumber) => '<li>item ' + itemNumber + '</li>').join('\n') + '\n</ul>' },
  { name: '80,000 unmatched inline backticks', source: 'text ' + '`'.repeat(80000), expected: '<p>text ' + '`'.repeat(80000) + '</p>' },
  { name: '50,000 inline stars', source: 'text ' + '*'.repeat(50000), expected: '<p>text ' + '*'.repeat(50000) + '</p>' },
];
for (const { name, source, expected } of performanceCases) {
  test('renders ' + name + ' in less than 200 ms', context => {
    const started = performance.now();
    const html = renderMarkdown(source);
    const elapsed = performance.now() - started;
    context.diagnostic(name + ': ' + elapsed.toFixed(3) + ' ms');
    assert.equal(html, expected);
    assert.ok(elapsed < 200, name + ' took ' + elapsed.toFixed(3) + ' ms');
  });
}

test('links keep all following text and formatting', () => {
  assert.equal(renderMarkdown('[x](safe) tail'), '<p><a href="safe">x</a> tail</p>');
  assert.equal(renderMarkdown('[x](https://example.com)*tail*'), '<p><a href="https://example.com" rel="noopener noreferrer" target="_blank">x</a><em>tail</em></p>');
  assert.equal(renderMarkdown('![x](safe.png)tail'), '<p><img src="safe.png" alt="x">tail</p>');
});
