import type { SchemaCollection } from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function jsonObject(raw: string): Record<string, unknown> {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const surrounded = start !== -1 && end > start ? text.slice(start, end + 1) : undefined;

  for (const candidate of new Set([text, fenced, surrounded])) {
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (isObject(value)) return value;
    } catch {
      // Try the next candidate without changing the model's JSON contents.
    }
  }
  throw new Error('模型未返回完整的 JSON 对象');
}

export function parseMikeOutput(raw: string, allowDiscussionOnly = false) {
  const { intent, projectTitle, summary, runEmma, runBob, runAlex } = jsonObject(raw);
  const discussionOnly = allowDiscussionOnly && intent === 'discussion_only';
  if (
    typeof intent !== 'string' ||
    (!discussionOnly && !['create_new', 'iterate_feature', 'visual_edit', 'bug_fix', 'prd_update'].includes(intent)) ||
    !isText(summary) ||
    typeof runEmma !== 'boolean' ||
    typeof runBob !== 'boolean' ||
    typeof runAlex !== 'boolean' ||
    (discussionOnly ? runEmma || runBob || runAlex : !(runEmma || runBob || runAlex))
  ) {
    throw new Error('模型未返回有效的协作计划');
  }
  return {
    intent,
    projectTitle: typeof projectTitle === 'string' ? projectTitle.trim() : '',
    summary,
    runEmma,
    runBob,
    runAlex,
  };
}

export function parseEmmaOutput(raw: string, requireHandoff = false) {
  const { chatSummary, prdMarkdown, handoff } = jsonObject(raw);
  if (!isText(chatSummary) || !isText(prdMarkdown)) {
    throw new Error('模型未返回完整的产品需求文档');
  }
  const next = handoff === 'none' || handoff === 'alex' || handoff === 'bob_alex' ? handoff : undefined;
  if (requireHandoff && !next) {
    throw new Error('Emma 未返回后续执行计划');
  }
  return { chatSummary, prdMarkdown, ...(next && { handoff: next }) };
}

function isCollection(value: unknown): value is SchemaCollection {
  return isObject(value) && isText(value.name) && typeof value.description === 'string' &&
    Array.isArray(value.fields) && value.fields.every(
      (field: unknown) => isObject(field) && isText(field.name) &&
        isText(field.type) && typeof field.description === 'string'
    );
}

export function parseBobOutput(raw: string) {
  const { chatSummary, architectureMarkdown, collections } = jsonObject(raw);
  if (
    !isText(chatSummary) || !isText(architectureMarkdown) ||
    (collections !== undefined && (!Array.isArray(collections) || !collections.every(isCollection)))
  ) {
    throw new Error('模型未返回完整的架构设计或有效的数据库结构');
  }
  return { chatSummary, architectureMarkdown, collections: collections ?? [] };
}

export function parseAlexOutput(raw: string, existingFiles: Record<string, string>) {
  let chatSummary: unknown;
  let versionSummary: unknown;
  let entries: Array<[string, unknown]>;
  const fileBlocks = [...raw.matchAll(/<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/gi)];

  if (fileBlocks.length) {
    if (fileBlocks.length !== [...raw.matchAll(/<file\s+path=["']/gi)].length) {
      throw new Error('模型返回的代码文件未完整结束');
    }
    chatSummary = raw.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1];
    versionSummary = raw.match(/<version>([\s\S]*?)<\/version>/i)?.[1];
    entries = fileBlocks.map(([, path, body]) => {
      const content = body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      const fenced = content.match(/^```[\w-]*\r?\n([\s\S]*?)\r?\n```$/);
      return [path, fenced?.[1] ?? content];
    });
  } else {
    try {
      const parsed = jsonObject(raw);
      ({ chatSummary, versionSummary } = parsed);
      entries = isObject(parsed.files) ? Object.entries(parsed.files) : [];
    } catch {
      throw new Error('模型未返回完整的代码文件');
    }
  }

  const files: Record<string, string> = Object.create(null);
  for (const [path, content] of entries) {
    if (!isText(path) || typeof content !== 'string') {
      throw new Error('模型返回了无效的代码文件');
    }
    files[path.trim()] = content;
  }
  if (!Object.keys(files).length) {
    throw new Error('模型未返回可保存的代码文件');
  }
  const mergedFiles = { ...existingFiles, ...files };
  if (!Object.entries(mergedFiles).some(([path, content]) => path.endsWith('.html') && isText(content))) {
    throw new Error('模型未返回可预览的 HTML 入口');
  }
  return {
    chatSummary: isText(chatSummary) ? chatSummary.trim() : '已完成应用代码构建并写入工作区。',
    versionSummary: isText(versionSummary) ? versionSummary.trim().slice(0, 60) : '应用更新',
    files: mergedFiles,
  };
}
