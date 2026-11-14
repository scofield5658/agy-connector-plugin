import type { Workflow } from '../contracts.js';
import { analyzeDocument } from './protected-content.js';
import { promptFor } from './prompt.js';
export function createPolishWorkflow(threshold = 0.5): Workflow {
  return {
    prepare(request) {
      if (!request.externalProcessingAllowed)
        return {
          applicable: false,
          code: 'EXTERNAL_PROCESSING_DISABLED',
          message: '用户禁止外部处理。',
        };
      if (request.operation === 'execute')
        return { applicable: false, code: 'SCOPE_UNSUPPORTED', message: '不执行外部操作。' };
      const doc = analyzeDocument(request.text, request.protectedText);
      if (!doc.prose.trim())
        return { applicable: false, code: 'NO_PROSE', message: '没有可润色正文。' };
      if (
        request.invocation === 'automatic' &&
        (request.documentKind === 'other' || doc.hanRatio < threshold)
      )
        return {
          applicable: false,
          code: 'NOT_APPLICABLE',
          message: '不属于主要为中文的文档或长文任务。',
        };
      return {
        applicable: true,
        prompt: promptFor(
          request,
          '润色中文表达，使其自然、准确、简洁，保持作者语气。保留全部事实、数字、专有名词、确定程度和 Markdown 结构，不添加理由或承诺。代码、行内代码、链接目标、占位符、frontmatter 和 protectedText 必须逐字保留。',
        ),
      };
    },
    validate(original, candidate) {
      const before = analyzeDocument(original.text, original.protectedText),
        after = analyzeDocument(candidate, original.protectedText);
      const protectedSignature = (doc: typeof before) =>
        doc.protectedSpans.map((s) => [s.kind, s.text]);
      if (JSON.stringify(protectedSignature(before)) !== JSON.stringify(protectedSignature(after)))
        return { accepted: false, warnings: [], reason: 'PROTECTED_CONTENT_CHANGED' };
      const warnings = ['REVIEW_FACTS_AND_CERTAINTY'];
      if (
        JSON.stringify(original.text.match(/\d+(?:[.,]\d+)*/g) ?? []) !==
        JSON.stringify(candidate.match(/\d+(?:[.,]\d+)*/g) ?? [])
      )
        warnings.push('NUMBERS_CHANGED');
      if (JSON.stringify(before.structure) !== JSON.stringify(after.structure))
        warnings.push('STRUCTURE_CHANGED');
      return { accepted: !!candidate.trim(), warnings };
    },
  };
}
export const polishWorkflow = createPolishWorkflow();
