import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
type AstNode = {
  type: string;
  value?: string;
  children?: AstNode[];
  referenceType?: 'full' | 'collapsed' | 'shortcut';
  position?: { start: { offset?: number }; end: { offset?: number } };
};
export type ProtectedSpan = { start: number; end: number; text: string; kind: string };
export type DocumentAnalysis = {
  prose: string;
  hanRatio: number;
  protectedSpans: ProtectedSpan[];
  structure: string[];
};
const parser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml']);
export function analyzeDocument(text: string, protectedText: string[]): DocumentAnalysis {
  const tree = parser.parse(text) as AstNode,
    spans: ProtectedSpan[] = [],
    prose: string[] = [],
    structure: string[] = [];
  function add(start: number, end: number, kind: string) {
    spans.push({ start, end, text: text.slice(start, end), kind });
  }
  function walk(node: AstNode) {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (
        [
          'code',
          'inlineCode',
          'yaml',
          'toml',
          'html',
          'definition',
          'image',
          'imageReference',
        ].includes(node.type)
      ) {
        add(start, end, node.type);
        return;
      }
      if (node.type === 'link') {
        const raw = text.slice(start, end);
        // Autolinks have no separate label; preserve their entire spelling.
        if (raw.startsWith('<')) {
          add(start, end, 'autolink');
          return;
        }
        // Children end at the label boundary, even when the title contains ](.
        const labelEnd = node.children?.at(-1)?.position?.end.offset ?? start + 1;
        add(labelEnd, end, 'link-target');
      }
      if (node.type === 'linkReference') {
        if (node.referenceType === 'full') {
          const labelEnd = node.children?.at(-1)?.position?.end.offset ?? start + 1;
          add(labelEnd, end, 'link-reference');
        } else {
          // In shortcut/collapsed links the visible label is also the destination key.
          add(start, end, 'link-reference');
        }
      }
    }
    if (['heading', 'list', 'table', 'blockquote'].includes(node.type)) structure.push(node.type);
    if (node.type === 'text' && node.value) prose.push(node.value);
    for (const child of node.children ?? []) walk(child);
  }
  walk(tree);
  for (const match of text.matchAll(/\{\{[^{}\r\n]+\}\}|\$\{[^{}\r\n]+\}|%(?:\d+\$)?[sdf]/g))
    add(match.index, match.index + match[0].length, 'placeholder');
  for (const term of new Set(protectedText)) {
    let start = text.indexOf(term);
    while (start >= 0) {
      add(start, start + term.length, 'explicit');
      start = text.indexOf(term, start + term.length);
    }
  }
  const joined = prose.join('\n');
  const letters = joined.match(/\p{L}/gu)?.length ?? 0;
  const han = joined.match(/\p{Script=Han}/gu)?.length ?? 0;
  return {
    prose: joined,
    hanRatio: letters ? han / letters : 0,
    protectedSpans: spans.sort((a, b) => a.start - b.start || a.end - b.end),
    structure,
  };
}
