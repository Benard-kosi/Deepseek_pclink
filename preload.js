const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
  console.log('[Electron Scraper HARDENED] Loaded');

  // Ask main whether results may be auto-sent back to the chat. Default: NO.
  let autoReturn = false;
  try { const c = await ipcRenderer.invoke('get-config'); autoReturn = !!(c && c.autoReturnToChat); } catch (e) {}

  const SELECTOR = 'div.ds-markdown';
  const sent = new Set();
  const pending = new Map();

  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };

  async function processText(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      const s = line.trim();

      // Handle !PHONE  (forwards to phone-bridge; same broker Claude uses)
      if (s.startsWith('!PHONE ')) {
        const rest = s.substring(7).trim();
        const sp = rest.indexOf(' ');
        const verb = (sp === -1 ? rest : rest.slice(0, sp)).trim();
        const argstr = sp === -1 ? '' : rest.slice(sp + 1);
        const args = {};
        const re = /(\w+)=(.*?)(?=\s+\w+=|$)/g; let m;
        while ((m = re.exec(argstr)) !== null) {
          let v = m[2].trim();
          if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
          else if (/^-?\d+\.\d+$/.test(v)) v = parseFloat(v);
          args[m[1]] = v;
        }
        const result = await ipcRenderer.invoke('phone-command', verb, args);
        deliver(result);
        return;
      }

      if (s.startsWith('!EXEC ')) {
        const raw = s.substring(6);
        const [cmd, reason] = raw.includes('::') ? raw.split('::') : [raw, 'No reason provided'];
        const result = await ipcRenderer.invoke('run-command', cmd.trim(), reason.trim());
        deliver(result);
        return;
      }

      if (s.startsWith('!FILE ')) {
        const raw = s.substring(6);
        const parts = raw.split('::');
        const reason = parts[1] ? parts[1].trim() : 'No reason provided';
        const match = parts[0].trim().match(/^(\w+)\s+([^\s]+)(?:\s+([\s\S]+))?$/);
        if (match) {
          const action = match[1];
          const target = match[2];
          const content = match[3] ? match[3].replace(/\\n/g, '\n') : '';
          const result = await ipcRenderer.invoke('file-op', action, target, content, reason);
          deliver(result);
          return;
        }
      }
    }
  }

  function scan() {
    document.querySelectorAll(SELECTOR).forEach(el => {
      if (el.closest('details')) return;
      const t = (el.innerText || '').trim();
      if (!t || t.startsWith('Thought for')) return;
      const k = hash(t);
      if (sent.has(k)) return;
      const prev = pending.get(el);
      if (prev && prev.text === t) return;
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => { if (el.isConnected) { sent.add(k); processText(t); } }, 1200);
      pending.set(el, { text: t, timer });
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();

  // Place the result in the chat box. Only auto-SEND if the user opted in via config.autoReturnToChat.
  // Otherwise the user sees exactly what would be transmitted to DeepSeek and presses Enter themselves.
  function deliver(text) {
    const ta = document.querySelector('textarea');
    if (!ta) return;
    const prefix = autoReturn ? '' : '[PC Link result — review before sending]\n';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, prefix + text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    if (autoReturn) {
      setTimeout(() => {
        const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        ta.dispatchEvent(enter);
      }, 500);
    }
  }
});
