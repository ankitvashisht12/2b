export type Fields = Record<string, unknown>;

// ponytail: values are plain scalars or one-line JSON (valid YAML flow style), so no YAML library.
// A hand-written block-style YAML list fails to parse; `2b check` reports it.
const PLAIN_SCALAR = /^[A-Za-z0-9_.\/~][A-Za-z0-9_ .\/~+:,()'-]*$/;
const YAML_KEYWORD = /^(true|false|yes|no|on|off|null|~)$/i;
const FRONTMATTER = /^---\n(?:([\s\S]*?)\n)?---(?:\n|$)/;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') return ' ' + JSON.stringify(value);
  const isPlain = PLAIN_SCALAR.test(value)
    && !value.includes(': ')
    && !value.endsWith(':')
    && !value.endsWith(' ')
    && !YAML_KEYWORD.test(value);
  return ' ' + (isPlain ? value : JSON.stringify(value));
}

function parseValue(key: string, raw: string): unknown {
  if (raw === '') return null;
  if (!/^["[{]/.test(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`frontmatter field "${key}" is not one-line JSON: ${raw}`);
  }
}

export function parse(text: string): { fields: Fields; body: string } {
  const match = text.match(FRONTMATTER);
  if (!match) return { fields: {}, body: text };
  const fields: Fields = {};
  for (const line of (match[1] ?? '').split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`frontmatter line has no key: ${line}`);
    const key = line.slice(0, separator).trim();
    fields[key] = parseValue(key, line.slice(separator + 1).trim());
  }
  return { fields, body: text.slice(match[0].length) };
}

export function serialize(fields: Fields, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}:${formatValue(value)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
