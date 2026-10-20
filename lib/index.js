/**
 * dsh-enhance-prompt — 宿主端
 * POST /enhance-prompt：单轮改写 + 本次/累计 token 记账。
 */
import z from '@deepseek-ai/schemastery';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-enhance-prompt';
export const inject = ['webServer', 'llm', 'agentDefaultModel'];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(HERE, '..', 'stats.json');

const SYSTEM_PROMPT = `Rewrite the user's prompt to be clearer and more specific while keeping its intent.

- Do not answer the request; only rewrite it.
- Do not invent technologies, tools, or facts.
- Reply in the input's language, with no labels.
- Chinese output: 200-350 characters. English: 300-450 characters.
- Output only the rewritten prompt.`;

const USER_TEMPLATE = `Improve the user prompt below while preserving its intent and language.

USER INPUT:
{input}

Rewrite it into a clearer, more specific prompt for the target AI assistant. Return only the enhanced prompt text.`;

export const Config = z.object({
  provider: z.string().default(''),
  model: z.string().default(''),
  maxTokens: z.number().default(2048),
  timeoutMs: z.number().default(60000),
  maxInputChars: z.number().default(5000),
});

function emptyStats() {
  return { inputTokens: 0, outputTokens: 0, calls: 0, failures: 0, since: new Date().toISOString() };
}

function loadStats() {
  try {
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...emptyStats(), ...parsed };
  } catch {
    return emptyStats();
  }
}

function saveStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.log('[enhance-prompt] stats write failed: ' + String(e?.message ?? e));
  }
}

function stripWrappingQuotes(text) {
  return text.trim().replace(/^["'\u201C\u201D\u2018\u2019]|["'\u201C\u201D\u2018\u2019]$/g, '');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function pickTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = usage.inputTokens ?? usage.input ?? usage.promptTokens ?? usage.prompt_tokens;
  const output = usage.outputTokens ?? usage.output ?? usage.completionTokens ?? usage.completion_tokens;
  if (input === undefined && output === undefined) return null;
  return { input: typeof input === 'number' ? input : null, output: typeof output === 'number' ? output : null };
}

/** 记一次账：成功失败都计次数，有 usage 才计 token。 */
function record(tokens, success) {
  const stats = loadStats();
  stats.calls += 1;
  if (!success) stats.failures += 1;
  if (tokens !== null) {
    stats.inputTokens += tokens.input ?? 0;
    stats.outputTokens += tokens.output ?? 0;
  }
  saveStats(stats);
  return stats;
}

export function apply(ctx, config) {
  const cfg = config ?? {};

  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: '/enhance-prompt',
    handler: async (req, res) => {
      if (req.method === 'GET') { send(res, 200, { success: true, cumulative: loadStats() }); return; }
      if (req.method !== 'POST') { send(res, 405, { success: false, code: 'method_not_allowed', error: 'POST only' }); return; }

      let body;
      try { body = await readBody(req); }
      catch (e) { send(res, 400, { success: false, code: 'bad_request', error: String(e?.message ?? e) }); return; }

      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text === '') {
        send(res, 200, { success: false, code: 'empty_input', error: '输入为空', cumulative: loadStats() });
        return;
      }
      if (text.length > cfg.maxInputChars) {
        send(res, 200, { success: false, code: 'too_long', error: `输入 ${text.length} 字，超过上限 ${cfg.maxInputChars} 字`, cumulative: loadStats() });
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        let selection;
        try { selection = ctx.agentDefaultModel?.currentSelection?.(); } catch { selection = undefined; }
        const provider = body.provider ?? selection?.provider ?? cfg.provider ?? '';
        const model = body.model ?? selection?.model ?? cfg.model ?? '';
        if (provider === '' || model === '') {
          const cumulative = record(null, false);
          send(res, 200, {
            success: false,
            code: 'no_model',
            error: '未能确定模型：请在插件配置里填写 provider/model，或先在会话里选一个默认模型',
            cumulative,
          });
          return;
        }

        const messages = [
          createUserMessage({
            content: [{ type: 'text', text: USER_TEMPLATE.replace('{input}', text) }],
            source: { kind: 'dsh-enhance-prompt' },
          }),
        ];

        const assembler = new BlockAssembler();
        for await (const chunk of ctx.llm.stream({
          provider,
          model,
          messages,
          system: SYSTEM_PROMPT,
          maxTokens: cfg.maxTokens,
          purpose: 'enhance-prompt',
          signal: controller.signal,
        })) {
          assembler.push(chunk);
        }

        const finish = assembler.finish;
        const blocks = assembler.blocks();
        const raw = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const tokens = pickTokens(assembler.usage);
        const enhanced = stripWrappingQuotes(raw);
        const ok = enhanced !== '' && (!finish || finish.kind === 'stop');
        const cumulative = record(tokens, ok);

        console.log('[enhance-prompt] provider=' + provider + ' model=' + model + ' finish=' + JSON.stringify(finish) + ' blocks=' + blocks.length + ' rawLen=' + raw.length + ' usage=' + JSON.stringify(assembler.usage));

        if (finish && finish.kind === 'error') {
          send(res, 200, { success: false, code: 'llm_error', error: finish.failure?.message ?? '模型返回错误', tokens, cumulative });
          return;
        }
        if (finish && finish.kind === 'max-tokens') {
          send(res, 200, { success: false, code: 'truncated', error: '模型输出被 maxTokens 截断', tokens, cumulative });
          return;
        }
        if (enhanced === '') {
          send(res, 200, { success: false, code: 'llm_error', error: '模型返回空结果（blocks=' + blocks.length + '）', tokens, cumulative });
          return;
        }
        send(res, 200, { success: true, text: enhanced, chars: enhanced.length, tokens, cumulative });
      } catch (e) {
        const aborted = controller.signal.aborted;
        const message = String(e?.message ?? e);
        let code = 'unknown';
        if (aborted) code = 'timeout';
        else if (/auth|credential|api.?key|unauthor/i.test(message)) code = 'auth_required';
        else if (/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) code = 'unavailable';
        else code = 'llm_error';
        const cumulative = record(null, false);
        console.log('[enhance-prompt] error: ' + message);
        send(res, 200, { success: false, code, error: message, cumulative });
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return () => dispose();
}