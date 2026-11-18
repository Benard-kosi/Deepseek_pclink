const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
  console.log('[Electron Scraper HARDENED+RETRY] Loaded');

  const SELECTOR = 'div.ds-markdown';
  const RAN_KEY  = 'scraper:ran:' + location.host;     // messages whose commands we already executed
  const PEND_KEY = 'scraper:pending:' + location.host;  // latest result awaiting confirmed delivery

  let ran = new Set();
  try { ran = new Set(JSON.parse(localStorage.getItem(RAN_KEY) || '[]')); } catch (e) {}
  function markRan(k) { ran.add(k); try { localStorage.setItem(RAN_KEY, JSON.stringify([...ran].slice(-500))); } catch (e) {} }

  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PEND_KEY) || 'null'); } catch (e) {}
  function setPending(p) { pending = p; try { localStorage.setItem(PEND_KEY, JSON.stringify(p)); } catch (e) {} }
  function clearPending() { pending = null; try { localStorage.removeItem(PEND_KEY); } catch (e) {} }

  let lastActivity = Date.now();
  const LAST_KEY = 'scraper:lastbatch:' + location.host;
  let lastBatch = null;
  try { lastBatch = localStorage.getItem(LAST_KEY) || null; } catch (e) {}
  let busy = false;
  const retried = new Set();
  function lastCmdLine() {
    if (!lastBatch) return '';
    const m = String(lastBatch).split('\n').map(x => x.trim()).find(x => /^!(EXEC|PHONE|FILE)\b/i.test(x));
    return m ? (m.length > 48 ? m.slice(0, 48) + '…' : m) : '';
  }
  function updateLast() {
    const el = document.getElementById('pclink-last');
    if (el) { const c = lastCmdLine(); el.textContent = c ? ('↻ ' + c) : ''; el.style.display = c ? 'block' : 'none'; el.title = lastBatch || ''; }
  }
  function badge() {
    let b = document.getElementById('pclink-badge');
    if (!b) {
      b = document.createElement('div');
      b.id = 'pclink-badge';
      b.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;font:12px/1.3 Segoe UI,Arial,sans-serif;background:#1e1e1e;color:#fff;border:1px solid #444;border-radius:8px;padding:7px 10px;box-shadow:0 2px 10px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:5px;max-width:330px;';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const dot = document.createElement('span'); dot.id = 'pclink-dot';
      dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#777;display:inline-block;flex:0 0 auto;';
      const txt = document.createElement('span'); txt.id = 'pclink-txt'; txt.textContent = 'PC Link: idle';
      const btn = document.createElement('button'); btn.id = 'pclink-rerun'; btn.textContent = 'Re-run last';
      btn.style.cssText = 'background:#4daafc;border:none;border-radius:4px;color:#000;font-weight:bold;cursor:pointer;padding:3px 7px;margin-left:auto;flex:0 0 auto;';
      btn.onclick = () => { if (lastBatch) { try { retried.delete(hash(lastBatch)); } catch (e) {} setStatus('re-running…', '#ffcc00'); processText(lastBatch); } };
      row.appendChild(dot); row.appendChild(txt); row.appendChild(btn);
      const last = document.createElement('div'); last.id = 'pclink-last';
      last.style.cssText = 'font-size:11px;color:#9ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:310px;display:none;';
      b.appendChild(row); b.appendChild(last);
      (document.body || document.documentElement).appendChild(b);
      updateLast();
    }
    return b;
  }
  function setStatus(text, color) {
    const b = badge();
    const t = b.querySelector('#pclink-txt'); if (t) t.textContent = 'PC Link: ' + text;
    const d = b.querySelector('#pclink-dot'); if (d) d.style.background = color || '#777';
  }
  setInterval(() => { try { badge(); } catch (e) {} }, 3000);
  try { badge(); } catch (e) {}
  const pendingScan = new Map();
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function cfg() { try { return await ipcRenderer.invoke('get-config'); } catch (e) { return {}; } }

  function setTA(ta, val) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, val);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function findSendButton() {
    return document.querySelector('[data-testid*="send" i], button[aria-label*="send" i], div[role="button"][aria-label*="send" i]');
  }
  function isGenerating() {
    return !!document.querySelector('[class*="stop" i], [aria-label*="Stop" i], [data-testid*="stop" i]');
  }

  // Try to post `text` into the chat and confirm it submitted (textarea clears). Returns true if sent.
  let lastSendTime = 0;
  function showCountdown(secs) {
    const b = badge();
    let cd = document.getElementById('pclink-cd');
    if (!cd) {
      cd = document.createElement('div');
      cd.id = 'pclink-cd';
      cd.style.cssText = 'font-size:11px;font-weight:bold;color:#ffcc00;';
      b.insertBefore(cd, b.firstChild);
    }
    cd.textContent = '⏳ next message in ' + secs + 's';
    cd.style.display = 'block';
  }
  function hideCountdown() { const cd = document.getElementById('pclink-cd'); if (cd) cd.style.display = 'none'; }
  async function cooldownBefore() {
    let c = {};
    try { c = await cfg(); } catch (e) {}
    const cdMs = ((c && c.sendCooldownSec) ? Number(c.sendCooldownSec) : 8) * 1000;
    let remain = cdMs - (Date.now() - lastSendTime);
    while (remain > 0) {
      showCountdown(Math.ceil(remain / 1000));
      await sleep(Math.min(500, remain));
      remain = cdMs - (Date.now() - lastSendTime);
    }
    hideCountdown();
  }
  async function trySendOnce(text) {
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    setTA(ta, text);
    ta.focus();
    await sleep(300);
    await cooldownBefore();                       // rate-limit guard (visible countdown)
    const ta3 = document.querySelector('textarea'); if (!ta3) return false;
    setTA(ta3, text);
    ta3.focus();
    ta3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    const btn = findSendButton();
    if (btn) { try { btn.click(); } catch (e) {} }
    lastSendTime = Date.now();
    await sleep(1300);
    const ta2 = document.querySelector('textarea');
    return !ta2 || !ta2.value.trim();   // empty box => it was submitted
  }

  function parsePhoneArgs(argstr) {
    const args = {};
    const re = /(\w+)=(.*?)(?=\s+\w+=|$)/g; let m;
    while ((m = re.exec(argstr)) !== null) {
      let v = m[2].trim();
      if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
      else if (/^-?\d+\.\d+$/.test(v)) v = parseFloat(v);
      args[m[1]] = v;
    }
    return args;
  }

  async function processText(text) {
    lastActivity = Date.now();
    setStatus('running…', '#ffcc00');
    busy = true;
    try {
    const lines = text.split('\n');
    let results = [];
    let foundCommand = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      let s = lines[i].trim();
      if (s.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;

      if (s === '!ENV') {
        foundCommand = true;
        const env = await ipcRenderer.invoke('get-env');
        results.push(`**SYSTEM INFO**\nConnected to a Windows PC + Android phone.\n\n**Trusted Folders:**\n${env.trustedFolders.map(f => '- ' + f).join('\n')}\n\n**Allowed Shell Commands:**\n${env.allowlist.join(', ')}\n\n*Use \`!EXEC\`, \`!FILE\`, or \`!PHONE <verb> key=value\`. Python/chaining disabled; use !PHONE for the phone.*`);
      }
      else if (s.startsWith('!EXEC ')) {
        foundCommand = true;
        const raw = s.substring(6);
        const [cmd, reason] = raw.includes('::') ? raw.split('::') : [raw, 'No reason provided'];
        const result = await ipcRenderer.invoke('run-command', cmd.trim(), reason.trim());
        if (result !== null) results.push('**Command:** `' + cmd.trim() + '`\n**Output:**\n```\n' + (typeof result === 'object' ? JSON.stringify(result) : String(result)) + '\n```');
      }
      else if (s.startsWith('!PHONE ')) {
        const rest = s.substring(7).trim();
        const sp = rest.indexOf(' ');
        const verb = (sp === -1 ? rest : rest.slice(0, sp)).trim();
        let argstr = sp === -1 ? '' : rest.slice(sp + 1);
        if (argstr.includes('::')) argstr = argstr.split('::')[0].trim();
        const a = argstr.trim();
        // ignore prose mentions: real command is "verb", "verb key=val...", or "verb :: reason"
        if (!/^[a-z_]+$/i.test(verb) || !(a === '' || /^\w+=/.test(a) || a.startsWith('::'))) continue;
        foundCommand = true;
        setStatus('running ' + verb + '…', '#ffcc00');
        const result = await ipcRenderer.invoke('phone-command', verb, parsePhoneArgs(argstr));
        if (result !== null) results.push('**Phone:** `' + verb + ' ' + argstr + '`\n**Result:**\n```\n' + (typeof result === 'object' ? JSON.stringify(result) : String(result)) + '\n```');
      }
      else if (s.startsWith('!FILE ')) {
        foundCommand = true;
        const raw = s.substring(6);
        const parts = raw.split('::');
        const reason = parts[1] ? parts[1].trim() : 'No reason provided';
        const match = parts[0].trim().match(/^(\w+)\s+([^\s]+)(?:\s+([\s\S]+))?$/);
        if (match) {
          const action = match[1], target = match[2];
          const content = match[3] ? match[3].replace(/\\n/g, '\n') : '';
          const result = await ipcRenderer.invoke('file-op', action, target, content, reason);
          if (result !== null) results.push('**File Op:** `' + action + ' ' + target + '`\n**Result:** ' + (typeof result === 'object' ? JSON.stringify(result) : String(result)));
        }
      }
    }

    if (foundCommand) {
      lastBatch = text; try { localStorage.setItem(LAST_KEY, text); } catch (e) {} updateLast();
      const k = hash(text);
      const failedToRun = results.some(r => /No answer from phone-bridge|is phone_bridge\.bat running|Error writing to phone-bridge inbox|phone-bridge not found/i.test(String(r)));
      if (results.length > 0 && !failedToRun) {
        setStatus('done ✓', '#4caf50');
        await deliver(results.join('\n\n---\n\n'));
      } else if (!retried.has(k)) {
        retried.add(k);
        setStatus('no reply — auto-rerunning…', '#ff9800');
        setTimeout(() => processText(text), 1500);
      } else {
        setStatus('failed ✗ — use Re-run', '#ff5555');
        if (results.length > 0) await deliver(results.join('\n\n---\n\n'));
      }
    }
    } finally { busy = false; lastActivity = Date.now(); }
  }

  // Deliver the combined result. In hands-free/auto-return mode we SET it as the latest pending
  // result and keep retrying (via watchdog) until the chat actually accepts it.
  async function deliver(text) {
    lastActivity = Date.now();
    const c = await cfg();
    const autoReturn = !!(c && (c.autoReturnToChat || c.autoAllow));
    if (!autoReturn) {
      const ta = document.querySelector('textarea');
      if (ta) { setTA(ta, '[PC Link result — review, then press Enter to send]\n' + text); ta.focus(); }
      return;
    }
    // Only the LATEST result is tracked; a newer command overwrites it (never go far back).
    setPending({ text, attempts: 0 });
    for (let i = 0; i < 3 && pending; i++) {
      lastActivity = Date.now();
      if (await trySendOnce(text)) { clearPending(); return; }
      if (pending) { pending.attempts++; setPending(pending); }
      await sleep(1000);
    }
  }

  const processedEl = new WeakSet();   // message elements already executed this session
  const preAtLoad = new WeakSet();     // messages already on the page right after load (history)
  const graceUntil = Date.now() + 3000;
  function scan() {
    document.querySelectorAll(SELECTOR).forEach(el => {
      if (el.closest('details')) return;
      if (el.closest('[class*="think"]')) return;
      if (el.closest('[class*="reason"]')) return;
      const t = (el.innerText || '').trim();
      if (!t || t.startsWith('Thought for') || t.startsWith('Thinking')) return;
      if (processedEl.has(el)) return;                     // same element, already handled
      const k = hash(t.replace(/\s+/g, ' '));             // normalize whitespace -> stable key across reloads
      if (Date.now() < graceUntil) preAtLoad.add(el);      // snapshot history briefly after load
      if (preAtLoad.has(el) && ran.has(k)) return;         // old history already run -> skip (don't re-run on refresh)
      const prev = pendingScan.get(el);
      if (prev && prev.text === t) return;
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        if (el.isConnected && !processedEl.has(el)) { processedEl.add(el); markRan(k); processText(t); }
      }, 1200);
      pendingScan.set(el, { text: t, timer });
    });
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();

  // Watchdog: keep re-sending the latest undelivered result until it lands (auto mode only).
  setInterval(async () => {
    try {
      const c = await cfg();
      if (!c || !c.autoAllow) return;
      if (busy) return;
      if (!pending) return;
      if (pending.attempts >= 12) { clearPending(); return; }   // give up eventually
      if (isGenerating()) return;                                // don't interrupt a reply
      lastActivity = Date.now();
      if (await trySendOnce(pending.text)) clearPending();
      else { pending.attempts++; setPending(pending); }
    } catch (e) {}
  }, 5000);

  // Auto-refresh so messages sent from the DeepSeek mobile app appear here. Only when auto is on,
  // the page is idle, the box is empty, nothing is generating, and no result is still pending.
  setInterval(async () => {
    try {
      const c = await cfg();
      if (!c || !c.autoAllow) return;
      if (busy) return;
      if (c.autoRefresh === false) return;
      if (pending) return;                                       // deliver the latest result first
      const idleMs = (c.autoRefreshSec || 20) * 1000;
      if (Date.now() - lastActivity < idleMs) return;
      const ta = document.querySelector('textarea');
      if (ta && ta.value && ta.value.trim()) return;
      if (isGenerating()) return;
      lastActivity = Date.now();
      location.reload();
    } catch (e) {}
  }, 7000);
});
