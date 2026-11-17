console.log("=== HARDENED DeepApp main.js RUNNING ===");
const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');   // execFile, NOT exec -> no shell

const BASE_DIR = "C:\\Users\\Espada\\Documents\\Deepseek_pclink";
const CONFIG_FILE = path.join(BASE_DIR, "config.json");

// Interpreters / launchers / net tools: blocked even if allowlisted (an allowlisted interpreter is not an allowlist).
const FORBIDDEN = new Set([
  "python","python3","py","pythonw","start","powershell","pwsh","cmd","node",
  "wscript","cscript","mshta","rundll32","regsvr32","bash","sh","wsl",
  "curl","wget","certutil","bitsadmin","ftp","scp","ssh","nc","ncat","telnet"
]);

let config = {
  autoAllow: false, showSkipped: false, autoReturnToChat: false,
  allowlist: ["echo","dir","type","whoami","ver","hostname","cd","vol","where","ffmpeg"],
  trustedFolders: [BASE_DIR],
  phoneBridgeDir: "C:\\Users\\Espada\\Documents\\phone-bridge"
};
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...loaded };
    if (!config.trustedFolders) config.trustedFolders = [BASE_DIR];
  } catch (e) {}
}

let mainWindow, settingsWindow;

// ---------- path confinement ----------
function guardPaths() {
  return [path.join(__dirname, 'main.js'), path.join(__dirname, 'preload.js'),
          path.join(__dirname, 'settings.html'), CONFIG_FILE].map(p => p.toLowerCase());
}
const SENSITIVE = [
  "\\.ssh\\","\\.aws\\","\\.gnupg\\","\\.config\\gcloud","\\.docker\\",
  "\\appdata\\local\\google\\chrome","\\appdata\\roaming\\mozilla","\\appdata\\local\\microsoft\\edge",
  "id_rsa","\\.env","\\.git\\config","\\ntuser.dat"
];
function trustedRoots() {
  const roots = (config.trustedFolders && config.trustedFolders.length) ? config.trustedFolders : [BASE_DIR];
  return roots.map(r => { try { return fs.realpathSync(r); } catch (e) { return path.resolve(r); } });
}
function resolveReal(p) {
  try { return fs.realpathSync(p); }
  catch (e) {
    let parent = path.dirname(p);
    try { parent = fs.realpathSync(parent); } catch (_) { parent = path.resolve(path.dirname(p)); }
    return path.join(parent, path.basename(p));
  }
}
function isSensitive(resolved) {
  const low = resolved.toLowerCase();
  if (SENSITIVE.some(s => low.includes(s.toLowerCase()))) return true;
  if (guardPaths().includes(low)) return true;
  return false;
}
function checkInsideTrusted(absPath) {
  const resolved = resolveReal(absPath);
  if (isSensitive(resolved)) return { ok: false, resolved, reason: "a blocked/sensitive location" };
  const low = (resolved + path.sep).toLowerCase();
  const ok = trustedRoots().some(root => {
    const r = (root.endsWith(path.sep) ? root : root + path.sep).toLowerCase();
    return low.startsWith(r) || resolved.toLowerCase() === root.toLowerCase();
  });
  return { ok, resolved, reason: ok ? null : "outside your trusted folders" };
}
const SHELL_META = /[&|<>^%`\n\r\u0000]/;
function tokenize(cmd) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '"') { q = !q; continue; }
    if (!q && /\s/.test(c)) { if (cur) { out.push(cur); cur = ""; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function looksLikePath(a) { return a.includes("\\") || /^[A-Za-z]:/.test(a) || a.startsWith("..") || a.startsWith("/"); }

// ---------- window / menu / settings (unchanged from DeepApp) ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 900, title: "PC Link",
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadURL('https://chat.deepseek.com');
  mainWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  buildMenu();
}
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 500, height: 600, parent: mainWindow, autoHideMenuBar: true, title: "PC Link Settings",
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.webContents.on('did-finish-load', () => settingsWindow.webContents.send('load-settings', config));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}
function buildMenu() {
  const template = [
    { label: 'File', submenu: [{ label: 'Settings', click: openSettings }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [{ label: 'About PC Link', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'About', message: 'PC Link v1.0' }) }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('save-settings', (event, newConfig) => {
  config = { ...config, ...newConfig };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
});
ipcMain.on('add-folder', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, { properties: ['openDirectory'] });
  if (!canceled && filePaths.length > 0) {
    if (!config.trustedFolders.includes(filePaths[0])) {
      config.trustedFolders.push(filePaths[0]);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      settingsWindow.webContents.send('update-folders', config.trustedFolders);
    }
  }
});
ipcMain.on('remove-folder', (event, folderToRemove) => {
  config.trustedFolders = config.trustedFolders.filter(f => f !== folderToRemove);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  settingsWindow.webContents.send('update-folders', config.trustedFolders);
});
ipcMain.handle('get-env', async () => ({ allowlist: config.allowlist, trustedFolders: config.trustedFolders, autoAllow: config.autoAllow }));
ipcMain.handle('get-config', () => ({ autoReturnToChat: !!config.autoReturnToChat, autoAllow: !!config.autoAllow, autoRefresh: config.autoRefresh !== false, autoRefreshSec: Number(config.autoRefreshSec || 20) }));

// ---------- !PHONE: forward to the existing phone-bridge (same broker Claude uses) ----------
const PHONE_BLOCK = new Set(["pc", "restart", "startup", "tcpip", "net"]);
function _formatPhone(r) {
  try {
    if (r && typeof r === 'object') {
      if (Array.isArray(r.ui)) {
        const lines = r.ui.map(e => {
          const label = e.text || e.desc || (e.rid ? ('[' + e.rid + ']') : '');
          if (!label && !e.edit) return null;
          const f = (e.click ? 'C' : '-') + (e.edit ? 'E' : '-');
          const c = e.center ? e.center.join(',') : '';
          return f + ' ' + c + ' ' + (e.cls || '') + ' ' + label;
        }).filter(Boolean).join('\n');
        const head = Object.assign({}, r); delete head.ui;
        return JSON.stringify(head) + '\n--- screen ---\n' + lines;
      }
      return JSON.stringify(r);
    }
    return String(r);
  } catch (e) { return String(r); }
}
ipcMain.handle('phone-command', async (event, verb, args) => {
  verb = String(verb || '').trim();
  args = args || {};
  if (!verb) return 'Refused: no phone verb given.';
  if (PHONE_BLOCK.has(verb.toLowerCase()))
    return "Refused: '" + verb + "' runs on the PC or reconfigures the bridge; not available via !PHONE. Use !EXEC for PC commands.";
  const bridge = config.phoneBridgeDir || "C:\\Users\\Espada\\Documents\\phone-bridge";
  const inbox = path.join(bridge, 'inbox'), outbox = path.join(bridge, 'outbox');
  if (!fs.existsSync(inbox)) return 'Error: phone-bridge not found at ' + bridge + ' (is phone_bridge.bat running?).';
  if (!config.autoAllow && !config.autoAllowPhone) {
    const argstr = Object.keys(args).map(k => k + '=' + args[k]).join(' ');
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Phone Command Request', message: 'Send to phone?\n\n' + verb + ' ' + argstr, detail: 'Routed through phone-bridge'
    });
    if (response !== 0) return config.showSkipped ? 'Skipped by user.' : null;
  }
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const payload = Object.assign({ id: id, cmd: verb }, args);
  try {
    const tmp = path.join(inbox, id + '.part');
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, path.join(inbox, id + '.json'));
  } catch (e) { return 'Error writing to phone-bridge inbox: ' + e.message; }
  const outfile = path.join(outbox, id + '.json');
  const timeoutMs = (args.timeout ? Number(args.timeout) * 1000 : 60000) + 2000;
  const t0 = Date.now();
  return await new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(outfile)) {
        try { const r = JSON.parse(fs.readFileSync(outfile, 'utf8')); let out = _formatPhone(r); if (out.length > 8000) out = out.slice(0, 8000) + '\n...[truncated]'; resolve(out); }
        catch (e) { setTimeout(tick, 150); }
        return;
      }
      if (Date.now() - t0 > timeoutMs) { resolve('No answer from phone-bridge (is phone_bridge.bat running?).'); return; }
      setTimeout(tick, 200);
    };
    tick();
  });
});

// ---------- hardened run-command ----------
ipcMain.handle('run-command', async (event, cmd, reason) => {
  cmd = String(cmd || "");
  if (SHELL_META.test(cmd)) return "Refused: shell metacharacters (& | > < ^ % ` newline) are not allowed.";
  const argv = tokenize(cmd);
  if (!argv.length) return "Refused: empty command.";
  const name = argv[0].toLowerCase();
  if (FORBIDDEN.has(name)) return "Refused: '" + name + "' can run arbitrary code and is blocked by this bridge.";
  if (!config.allowlist.map(s => String(s).toLowerCase()).includes(name)) return "Refused: '" + name + "' is not on the allowlist.";
  for (const a of argv.slice(1)) {
    if (looksLikePath(a)) {
      const abs = path.isAbsolute(a) ? a : path.resolve(BASE_DIR, a);
      const chk = checkInsideTrusted(abs);
      if (!chk.ok) return "Refused: path argument '" + a + "' is " + chk.reason + ".";
    }
  }
  if (!config.autoAllow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Command Execution Request', message: 'Run this command?\n\n' + argv.join(' '),
      detail: 'Working dir: ' + BASE_DIR + '\nWhy: ' + String(reason || '').slice(0, 500)
    });
    if (response !== 0) return config.showSkipped ? 'Skipped by user.' : null;
  }
  return new Promise((resolve) => {
    execFile('cmd', ['/d', '/s', '/c', ...argv], { cwd: BASE_DIR, timeout: 1800000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout || stderr) resolve(String(stdout || stderr));
      else if (error) resolve(String(error.message || error || "Command failed."));
      else resolve("Executed successfully (no output)");
    });
  });
});

// ---------- hardened file-op (keeps clipboard + write_b64) ----------
ipcMain.handle('file-op', async (event, action, target, content, reason) => {
  if (action === 'read' && target === 'clipboard') return clipboard.readText() || "(clipboard empty)";
  if (action === 'write' && target === 'clipboard') { clipboard.writeText(content); return "Copied to clipboard"; }

  const abs = path.isAbsolute(target) ? target : path.resolve(BASE_DIR, String(target || ""));
  const chk = checkInsideTrusted(abs);
  if (!chk.ok) return "Access denied: target is " + chk.reason + ".";
  const targetPath = chk.resolved;

  if (!config.autoAllow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'File Operation Request', message: action.toUpperCase() + '\n\n' + targetPath, detail: 'Why: ' + String(reason || '').slice(0, 500)
    });
    if (response !== 0) return config.showSkipped ? 'Skipped by user.' : null;
  }

  try {
    if (action === 'write' || action === 'write_b64') {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (action === 'write_b64') fs.writeFileSync(targetPath, Buffer.from(content, 'base64'));
      else fs.writeFileSync(targetPath, content, 'utf8');
      return "Wrote to " + targetPath;
    } else if (action === 'read') {
      return fs.readFileSync(targetPath, 'utf8');
    } else if (action === 'list') {
      return fs.readdirSync(targetPath).join(String.fromCharCode(10));
    } else if (action === 'delete') {
      if (fs.statSync(targetPath).isDirectory()) fs.rmdirSync(targetPath);
      else fs.unlinkSync(targetPath);
      return "Deleted " + targetPath;
    }
    return "Unknown action: " + action;
  } catch (err) {
    return "Error: " + err.message;
  }
});


// ---------- Telegram remote control for autoAllow (text "auto on" / "auto off") ----------
const TG_TOKEN = config.telegramToken || "";
const TG_CHAT = String(config.telegramChatId || "");
let tgOffset = 0;
async function tgSend(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text })
    });
  } catch (e) {}
}
async function tgPoll() {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?timeout=30&offset=${tgOffset}`);
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.result)) {
      for (const u of data.result) {
        tgOffset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.text) continue;
        const fromId = String((msg.from && msg.from.id) || (msg.chat && msg.chat.id) || "");
        if (fromId !== TG_CHAT) continue;            // ONLY the owner can toggle
        const t = msg.text.trim().toLowerCase();
        if (t === 'auto on' || t === 'on') {
          config.autoAllow = true;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
          await tgSend('✅ Auto-allow ON — DeepSeek acts on your PC + phone without prompts.');
        } else if (t === 'auto off' || t === 'off') {
          config.autoAllow = false;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
          await tgSend('🛑 Auto-allow OFF — every action prompts again.');
        } else if (t === 'refresh on') {
          config.autoRefresh = true;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
          await tgSend('\uD83D\uDD04 Auto-refresh ON — the laptop will reload to catch messages sent from mobile.');
        } else if (t === 'refresh off') {
          config.autoRefresh = false;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
          await tgSend('\u23F8 Auto-refresh OFF — the laptop will not reload (use this while typing at the PC).');
        } else if (t === 'status') {
          await tgSend('autoAllow = ' + config.autoAllow + '\nautoRefresh = ' + (config.autoRefresh !== false));
        }
      }
    }
  } catch (e) {}
  setTimeout(tgPoll, 1000);
}

app.whenReady().then(() => { createWindow(); tgPoll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
