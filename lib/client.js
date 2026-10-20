/**
 * dsh-enhance-prompt — 浏览器端
 * 工具栏里的 ✨ 按钮（麦克风左侧），纯图标，不占额外空间。
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

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const SPARK_SVG = '<svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.1 1.6l1.05 2.75L9.9 5.4 7.15 6.45 6.1 9.2 5.05 6.45 2.3 5.4l2.75-1.05L6.1 1.6z"/><path d="M11.6 8.3l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z"/></svg>';

    function findEditor() {
      return document.querySelector('[contenteditable="true"]');
    }

    function readDraft(editor) {
      if (editor === null) return '';
      return (editor.innerText || editor.textContent || '').trim();
    }

    function selectAllIn(editor) {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      if (selection !== null) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    function writeDraft(editor, text) {
      if (editor === null) return false;
      const before = (editor.innerText || '').trim();
      try { selectAllIn(editor); document.execCommand('insertText', false, text); } catch {}
      let after = (editor.innerText || '').trim();
      if (after !== before && after !== '') return true;
      try {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
      } catch {}
      after = (editor.innerText || '').trim();
      if (after !== before && after !== '') return true;
      try { navigator.clipboard.writeText(text); } catch {}
      return false;
    }

    function toast(message) {
      try {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:99999;background:rgba(30,30,30,.94);color:#fff;font-size:13px;line-height:1.5;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:min(560px,80vw);white-space:pre-line';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      } catch {}
    }

    async function runEnhance(button) {
      const editor = findEditor();
      const text = readDraft(editor);
      if (text === '') { toast('输入框是空的，先写点内容再增强'); return; }
      button.disabled = true;
      button.classList.add('dsh-ep-busy');
      try {
        const response = await fetch('/enhance-prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await response.json();
        if (data && data.success && typeof data.text === 'string' && data.text !== '') {
          writeDraft(editor, data.text);
        } else {
          toast((data && data.error) || '增强失败');
        }
      } catch (e) {
        toast('请求增强服务失败：' + String((e && e.message) || e));
      } finally {
        button.disabled = false;
        button.classList.remove('dsh-ep-busy');
      }
    }

    function createButton() {
      ensureStyle();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dsh-ep-btn';
      button.title = '增强提示词';
      button.setAttribute('aria-label', '增强提示词');
      button.setAttribute(MARK, '');
      button.innerHTML = SPARK_SVG;
      button.addEventListener('click', () => { runEnhance(button); });
      button.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        try {
          const response = await fetch('/enhance-prompt', { method: 'GET' });
          const data = await response.json();
          const c = data && data.cumulative;
          if (!c) { toast('暂无统计'); return; }
          const total = (c.inputTokens || 0) + (c.outputTokens || 0);
          toast('增强消耗统计\n输入 ' + (c.inputTokens || 0) + ' / 输出 ' + (c.outputTokens || 0) + ' tokens（共 ' + total + '）\n调用 ' + (c.calls || 0) + ' 次，失败 ' + (c.failures || 0) + ' 次\n统计自 ' + (c.since || '未知') + '\n口径：仅本插件增强调用，不含对话消耗', 8000);
        } catch { toast('读取统计失败'); }
      });
      return button;
    }

    function findAnchor(editor) {
      let node = editor;
      for (let depth = 0; depth < 10 && node !== null; depth++) {
        node = node.parentElement;
        if (node === null) break;
        const buttons = [...node.querySelectorAll('button')];
        if (buttons.length < 2) continue;
        const voice = buttons.find((b) => /语音|麦克风|voice|microphone/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')));
        if (voice !== undefined && voice.parentElement !== null) return voice;
        const last = buttons[buttons.length - 1];
        if (last.parentElement !== null) return last;
      }
      return null;
    }

    function mount() {
      if (document.querySelector('[' + MARK + ']') !== null) return true;
      const editor = findEditor();
      if (editor === null) return false;
      const anchor = findAnchor(editor);
      if (anchor === null) return false;
      anchor.insertAdjacentElement('beforebegin', createButton());
      return true;
    }

    function start() {
      ensureStyle();
      mount();
      try {
        const observer = new MutationObserver(() => { mount(); });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {}
      let tries = 0;
      const tick = () => {
        tries += 1;
        if (mount() || tries > 240) return;
        setTimeout(tick, 500);
      };
      setTimeout(tick, 500);
    }

    const inject = [];

    function apply() {
      start();
    }

    return { apply, inject };
  },
});