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
  // 2048 会被推理型模型的思考过程吃满（finish=max-tokens、正文为空），
  // 这里给足空间；仍可在插件配置里覆盖。
  maxTokens: z.number().default(8192),
  timeoutMs: z.number().default(60000),
  maxInputChars: z.number().default(5000),
  // dsh-go 原生界面的「增强」胶囊（需要主机装有 dsh-go 桥接）。关掉只影响原生胶囊，
  // 网页版输入框里的 ✨ 按钮不受影响。
  nativeCapsule: z.boolean().default(true),
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

/** 按字符（码点）截断，给 dsh-go 的 toast / insert 上限用。 */
function clip(text, limit) {
  return [...String(text ?? '')].slice(0, limit).join('');
}

/**
 * 单轮改写：HTTP 路由与 dsh-go 原生胶囊共用。
 * @returns {Promise<{ ok: boolean, text?: string, code?: string, error?: string, tokens: object|null }>}
 */
async function enhanceOnce(ctx, cfg, text, options = {}) {
  const controller = new AbortController();
  const budget = Math.max(1000, Math.min(cfg.timeoutMs, options.timeoutMs ?? cfg.timeoutMs));
  const timer = setTimeout(() => controller.abort(), budget);
  const relay = () => controller.abort();
  if (options.signal !== undefined && options.signal !== null) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', relay, { once: true });
  }
  try {
    let selection;
    try { selection = ctx.agentDefaultModel?.currentSelection?.(); } catch { selection = undefined; }
    const provider = options.provider ?? selection?.provider ?? cfg.provider ?? '';
    const model = options.model ?? selection?.model ?? cfg.model ?? '';
    if (provider === '' || model === '') {
      record(null, false);
      return {
        ok: false,
        code: 'no_model',
        error: '未能确定模型：请在插件配置里填写 provider/model，或先在会话里选一个默认模型',
        tokens: null,
      };
    }

    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: USER_TEMPLATE.replace('{input}', () => text) }],
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
    record(tokens, ok);

    console.log('[enhance-prompt] provider=' + provider + ' model=' + model + ' finish=' + JSON.stringify(finish) + ' blocks=' + blocks.length + ' rawLen=' + raw.length + ' usage=' + JSON.stringify(assembler.usage));

    if (finish && finish.kind === 'error') {
      return { ok: false, code: 'llm_error', error: finish.failure?.message ?? '模型返回错误', tokens };
    }
    if (finish && finish.kind === 'max-tokens') {
      return {
        ok: false,
        code: 'truncated',
        error: raw === ''
          ? `模型把 ${cfg.maxTokens} 个输出 token 用在了思考过程上，没有返回正文；请在插件配置里调大 maxTokens`
          : '模型输出被 maxTokens 截断；请在插件配置里调大 maxTokens',
        tokens,
      };
    }
    if (enhanced === '') {
      return { ok: false, code: 'llm_error', error: '模型返回空结果（blocks=' + blocks.length + '）', tokens };
    }
    return { ok: true, text: enhanced, tokens };
  } catch (e) {
    const message = String(e?.message ?? e);
    let code;
    if (controller.signal.aborted) code = 'timeout';
    else if (/auth|credential|api.?key|unauthor/i.test(message)) code = 'auth_required';
    else if (/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) code = 'unavailable';
    else code = 'llm_error';
    record(null, false);
    console.log('[enhance-prompt] error: ' + message);
    return { ok: false, code, error: message, tokens: null };
  } finally {
    clearTimeout(timer);
    if (options.signal !== undefined && options.signal !== null) {
      options.signal.removeEventListener('abort', relay);
    }
  }
}

/** 每次请求的处理器（闭包持有配置，便于 apply 内注册与重试）。 */
function createHandler(ctx, cfg) {
  return async (req, res) => {
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

    const result = await enhanceOnce(ctx, cfg, text, { provider: body.provider, model: body.model });
    if (!result.ok) {
      send(res, 200, { success: false, code: result.code, error: result.error, tokens: result.tokens, cumulative: loadStats() });
      return;
    }
    send(res, 200, { success: true, text: result.text, chars: result.text.length, tokens: result.tokens, cumulative: loadStats() });
  };
}

export function apply(ctx, config) {
  const cfg = {
    provider: config?.provider ?? '',
    model: config?.model ?? '',
    maxTokens: typeof config?.maxTokens === 'number' ? config.maxTokens : 8192,
    timeoutMs: typeof config?.timeoutMs === 'number' ? config.timeoutMs : 60000,
    maxInputChars: typeof config?.maxInputChars === 'number' ? config.maxInputChars : 5000,
    nativeCapsule: config?.nativeCapsule !== false,
  };
  const handler = createHandler(ctx, cfg);

  // dsh-go（Android 客户端）原生界面：输入框上方那排胶囊里的「增强」。
  // 桥接不存在（没装 dsh-go 桥接的主机）时这个回调根本不执行，网页版一概不受影响。
  // 胶囊拿到的 scope.draft 就是输入框里的文字（清单里 wants: ["draft"]）。
  // 原生协议没有「整体替换输入框」的效果，只能 insert 到光标处。
  try {
    ctx.inject(['dshGo'], (inner) => {
      const bridge = inner.dshGo;
      if (bridge === undefined || bridge === null || typeof bridge.on !== 'function') return;
      bridge.on('enhance', (seat, event) => {
        const en = typeof event?.locale === 'string' && event.locale.toLowerCase().startsWith('en');
        if (cfg.nativeCapsule === false) return { toast: en ? 'Native capsule is off in plugin settings' : '原生胶囊已在插件设置里关闭' };
        const draft = typeof seat?.draft === 'string' ? seat.draft.trim() : '';
        if (draft === '') return { toast: en ? 'Composer is empty' : '输入框是空的' };
        if ([...draft].length > cfg.maxInputChars) {
          return { toast: en ? `Draft over ${cfg.maxInputChars} chars` : `草稿超过 ${cfg.maxInputChars} 字` };
        }
        return {
          pending: { label: en ? 'Enhancing' : '正在增强', timeoutMs: 60000 },
          result: async (signal) => {
            const result = await enhanceOnce(ctx, cfg, draft, { signal, timeoutMs: 55000 });
            if (!result.ok) return { toast: clip(result.error ?? (en ? 'Enhance failed' : '增强失败'), 40) };
            return {
              insert: clip(result.text, 2000),
              toast: en ? 'Enhanced text inserted' : '增强结果已插入输入框',
            };
          },
        };
      });
    });
  } catch (e) {
    console.log('[enhance-prompt] dsh-go capsule skipped: ' + String(e?.message ?? e));
  }

  // HMR / live reload 时旧实例的 dispose 可能晚于新实例的 apply：
  // 同一路径的重复注册会抛 duplicate，短暂重试等旧路由释放后再注册。
  ctx.effect(() => {
    let disposed = false;
    let retry = null;
    let off = null;
    const attach = (attempt) => {
      if (disposed) return;
      try {
        off = ctx.webServer.register({ kind: 'exact', path: '/enhance-prompt', handler });
      } catch (e) {
        const message = String(e?.message ?? e);
        if (!disposed && /duplicate/i.test(message) && attempt < 40) {
          retry = setTimeout(() => { retry = null; attach(attempt + 1); }, 250);
          return;
        }
        console.log('[enhance-prompt] route registration failed: ' + message);
      }
    };
    attach(0);
    return () => {
      disposed = true;
      if (retry !== null) { clearTimeout(retry); retry = null; }
      if (typeof off === 'function') { const release = off; off = null; release(); }
    };
  }, 'dsh-enhance-prompt: POST /enhance-prompt');
}
