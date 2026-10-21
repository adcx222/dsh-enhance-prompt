/**
 * dsh-enhance-prompt — 浏览器端
 * 工具栏里的 ✨ 按钮（发送按钮左侧），纯图标，不占额外空间。
 *
 * 写回草稿走 composer 的官方 InputActions（Lexical 编辑器），不再直接改 DOM：
 * 之前在 contenteditable 上 select-all + textContent 会让 Lexical 状态与 DOM
 * 脱节，表现就是「点了没反应」或输入框后续无法正常插入文件引用。
 */
window.__ModuleLoader__.load({
  id: 'dsh-enhance-prompt',
  factory: (require) => {
    const MARK = 'data-enhance-prompt';
    const STYLE_ID = 'dsh-enhance-prompt-style';
    const CSS = `
.dsh-ep-btn { width: 28px; height: 28px; padding: 0; border: none; background: transparent; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-text-l3, #8a8a8a); transition: background-color .15s ease, color .15s ease; flex: none; }
.dsh-ep-btn:hover:not(:disabled) { background: var(--dsw-alias-fill-l2, rgba(127,127,127,.12)); color: var(--dsw-alias-text-l1, #333); }
.dsh-ep-btn:disabled { cursor: progress; opacity: .55; }
.dsh-ep-btn svg { display: block; }
.dsh-ep-busy { animation: dsh-ep-pulse 1.1s ease-in-out infinite; }
@keyframes dsh-ep-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
`;

    // { sessions, conversation } —— 由 ctx.inject 在服务就绪后注入。
    let services = null;
    // 本实例插入的按钮，dispose 时只清理自己创建的，避免 HMR 时误删新实例的按钮。
    const created = new Set();

    let observer = null;
    let framePending = false;
    let retryTimer = null;
    let running = false;

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const SPARK_SVG = '<svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.1 1.6l1.05 2.75L9.9 5.4 7.15 6.45 6.1 9.2 5.05 6.45 2.3 5.4l2.75-1.05L6.1 1.6z"/><path d="M11.6 8.3l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z"/></svg>';

    function isVisible(el) {
      if (el === null || el === undefined || el.isConnected === false) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }

    /** 所有可见的 composer 编辑器（分栏/多标签时可能有多个，每个都要挂按钮）。 */
    function findEditors() {
      const all = [...document.querySelectorAll('[contenteditable="true"]')];
      const composers = all.filter((el) => isVisible(el) && el.closest('[data-conversation-session]') !== null);
      if (composers.length > 0) return composers;
      return all.filter(isVisible).slice(0, 1);
    }

    /** 编辑器所在的输入卡片：向上找到包含隐藏 file input 的容器。 */
    function composerCard(editor) {
      let node = editor;
      for (let depth = 0; depth < 12 && node !== null; depth++) {
        node = node.parentElement;
        if (node === null || node === document.body) break;
        if (node.querySelector('input[type="file"]') !== null) return node;
      }
      node = editor;
      for (let depth = 0; depth < 12 && node !== null; depth++) {
        node = node.parentElement;
        if (node === null || node === document.body) break;
        if (findAnchor(node) !== null) return node;
      }
      return null;
    }

    /** 按钮锚点：发送/停止按钮（原来的位置就是发送按钮左侧）。 */
    function findAnchor(card) {
      const buttons = [...card.querySelectorAll('button')].filter(isVisible);
      if (buttons.length === 0) return null;
      const candidates = buttons.filter((b) => /发送|停止|send|stop/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')));
      // 发送/停止按钮在工具栏最右侧：取最后一个匹配项，避免录音停止之类的按钮抢位。
      if (candidates.length > 0) return candidates[candidates.length - 1];
      return buttons[buttons.length - 1];
    }

    /** 取当前 composer 的官方输入动作面；拿不到就返回 null，走兼容回退。 */
    function shellFor(editor) {
      if (services === null || editor === null || editor === undefined) return null;
      let host = null;
      try { host = editor.closest('[data-conversation-session]'); } catch (e) { host = null; }
      const sessionId = host === null || host === undefined ? '' : host.getAttribute('data-conversation-session');
      if (sessionId === null || sessionId === '') return null;
      try {
        const actx = services.sessions.scope(sessionId);
        if (actx === undefined || actx === null) return null;
        const shell = services.conversation.input.for(actx);
        return shell === undefined ? null : shell;
      } catch (e) {
        return null;
      }
    }

    function readDraft(editor) {
      if (editor === null || editor === undefined) return '';
      const shell = shellFor(editor);
      if (shell !== null) {
        try {
          const projection = shell.projection;
          if (projection !== undefined && projection !== null && typeof projection.clipboardText === 'string') {
            const text = projection.clipboardText.trim();
            if (text !== '') return text;
          }
        } catch (e) { /* fall through */ }
      }
      return (editor.innerText || editor.textContent || '').trim();
    }

    /**
     * 写回草稿。
     * 1) 首选 shell.actions.setDraft —— Lexical 的官方整段替换入口；
     * 2) 退路只用浏览器编辑命令（Lexical 能处理 selectAll 命令），
     *    绝不再直接写 textContent，避免把编辑器状态弄坏。
     */
    function writeDraft(editor, shell, text) {
      if (shell !== null) {
        try {
          shell.actions.setDraft(text);
          const projection = shell.projection;
          if (projection !== undefined && projection !== null && typeof projection.clipboardText === 'string') {
            if (projection.clipboardText.trim() === text.trim()) return 'shell';
          }
          if ((editor.innerText || '').trim() === text.trim()) return 'shell';
        } catch (e) { /* fall through */ }
      }
      try {
        if (editor !== null && editor !== undefined && editor.isConnected !== false) {
          editor.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
          if ((editor.innerText || '').trim() === text.trim()) return 'dom';
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* fall through */ }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok === true;
      } catch (e) {
        return false;
      }
    }

    function toast(message) {
      try {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:99999;background:rgba(30,30,30,.94);color:#fff;font-size:13px;line-height:1.5;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:min(560px,80vw);white-space:pre-line';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      } catch (e) { /* ignore */ }
    }

    async function runEnhance(button, editor) {
      const target = editor !== null && editor !== undefined && editor.isConnected !== false
        ? editor
        : findEditors()[0];
      if (target === undefined || target === null) {
        toast('找不到输入框，请先点一下输入框再试');
        return;
      }
      const shell = shellFor(target);
      const text = readDraft(target);
      if (text === '') { toast('输入框是空的，先写点内容再增强'); return; }
      // 记下草稿版本：请求期间用户继续输入/加文件时，不覆盖新内容。
      const rev = shell !== null ? shell.rev : null;

      button.disabled = true;
      button.classList.add('dsh-ep-busy');
      try {
        const response = await fetch('/enhance-prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        let data = null;
        try { data = await response.json(); } catch (e) { data = null; }
        if (data !== null && data !== undefined && data.success === true && typeof data.text === 'string' && data.text !== '') {
          const sameTarget = target.isConnected !== false && (shell === null || shellFor(target) === shell);
          if (sameTarget === false) {
            const copied = await copyText(data.text);
            toast(copied
              ? '输入框已切换，增强结果已复制到剪贴板'
              : '输入框已切换，增强结果未写入');
            return;
          }
          if (shell !== null && rev !== null && shell.rev !== rev) {
            const copied = await copyText(data.text);
            toast(copied
              ? '增强期间草稿有改动，为避免覆盖，结果已复制到剪贴板'
              : '增强期间草稿有改动，已保留你的改动（增强结果未写入）');
            return;
          }
          if (writeDraft(target, shell, data.text) === false) {
            const copied = await copyText(data.text);
            toast(copied
              ? '增强完成，但写入输入框失败；结果已复制到剪贴板'
              : '增强完成，但写入输入框失败');
          }
        } else {
          toast((data !== null && data !== undefined && data.error) || ('增强失败（HTTP ' + response.status + '）'));
        }
      } catch (e) {
        toast('请求增强服务失败：' + String((e && e.message) || e));
      } finally {
        button.disabled = false;
        button.classList.remove('dsh-ep-busy');
      }
    }

    function createButton(editor) {
      ensureStyle();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dsh-ep-btn';
      button.title = '增强提示词';
      button.setAttribute('aria-label', '增强提示词');
      button.setAttribute(MARK, '');
      button.innerHTML = SPARK_SVG;
      button.addEventListener('click', () => { runEnhance(button, editor); });
      button.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        try {
          const response = await fetch('/enhance-prompt', { method: 'GET' });
          const data = await response.json();
          const c = data && data.cumulative;
          if (!c) { toast('暂无统计'); return; }
          const total = (c.inputTokens || 0) + (c.outputTokens || 0);
          toast('增强消耗统计\n输入 ' + (c.inputTokens || 0) + ' / 输出 ' + (c.outputTokens || 0) + ' tokens（共 ' + total + '）\n调用 ' + (c.calls || 0) + ' 次，失败 ' + (c.failures || 0) + ' 次\n统计自 ' + (c.since || '未知') + '\n口径：仅本插件增强调用，不含对话消耗', 8000);
        } catch (e) {
          toast('读取统计失败');
        }
      });
      created.add(button);
      return button;
    }

    function mountOne(editor) {
      const card = composerCard(editor);
      if (card === null) return false;
      if (card.querySelector('[' + MARK + ']') !== null) return true;
      const anchor = findAnchor(card);
      if (anchor === null || anchor.parentElement === null) return false;
      anchor.insertAdjacentElement('beforebegin', createButton(editor));
      return true;
    }

    function mountAll() {
      if (running === false) return;
      for (const editor of findEditors()) {
        try { mountOne(editor); } catch (e) { /* keep other composers working */ }
      }
    }

    function scheduleMount() {
      if (running === false || framePending) return;
      framePending = true;
      const run = () => { framePending = false; mountAll(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 50);
    }

    function start() {
      running = true;
      ensureStyle();
      mountAll();
      try {
        observer = new MutationObserver(scheduleMount);
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) { observer = null; }
      // 首次渲染阶段的兜底轮询（之后交给 observer，不再长期空转）。
      let tries = 0;
      const tick = () => {
        tries += 1;
        mountAll();
        if (tries < 60) retryTimer = setTimeout(tick, 1000);
      };
      retryTimer = setTimeout(tick, 500);
    }

    function stop() {
      running = false;
      if (observer !== null) { observer.disconnect(); observer = null; }
      framePending = false;
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
      for (const button of created) {
        try { button.remove(); } catch (e) { /* ignore */ }
      }
      created.clear();
    }

    const inject = [];

    function apply(ctx) {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          start();
          return () => { stop(); services = null; };
        }, 'dsh-enhance-prompt: toolbar mount');
        if (typeof ctx.inject === 'function') {
          ctx.effect(() => ctx.inject(['sessions', 'conversation'], (scope) => {
            services = {
              sessions: scope.sessions,
              conversation: scope.get('conversation'),
            };
            return () => { services = null; };
          }), 'dsh-enhance-prompt: draft services');
        }
      } else {
        start();
      }
    }

    return { apply, inject };
  },
});
