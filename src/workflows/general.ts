import type { Workflow } from '../contracts.js';
import { promptFor } from './prompt.js';
export const generalWorkflow: Workflow = {
  prepare(request) {
    if (!request.externalProcessingAllowed)
      return {
        applicable: false,
        code: 'EXTERNAL_PROCESSING_DISABLED',
        message: '用户禁止外部处理。',
      };
    if (request.invocation !== 'explicit')
      return { applicable: false, code: 'EXPLICIT_INTENT_REQUIRED', message: '需用户明确委托。' };
    if (request.operation === 'execute')
      return {
        applicable: false,
        code: 'SCOPE_UNSUPPORTED',
        message: '仅支持材料分析、变换及候选生成。',
      };
    return {
      applicable: true,
      prompt: promptFor(
        request,
        '按宿主明确委托的目标、语言和格式处理提供的材料。建议代码仅作为文本，不执行。区分材料中的事实、推断和缺失信息。',
      ),
    };
  },
  validate(_original, candidate) {
    return { accepted: !!candidate.trim(), warnings: ['HOST_REVIEW_REQUIRED'] };
  },
};
