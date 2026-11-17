console.log("=== HARDENED MAIN.JS RUNNING ===");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');   // NOTE: execFile, NOT exec -> no shell

const BASE_DIR = "C:\\Users\\Espada\\Documents\\Deepseek_pclink";
const CONFIG_FILE = path.join(BASE_DIR, "config.json");

// Interpreters / launchers / network tools = "run arbitrary code or exfiltrate".
// These are BLOCKED even if present in the allowlist. (An allowlisted interpreter is not an allowlist.)
const FORBIDDEN = new Set([
  "python","python3","py","pythonw","start","powershell","pwsh","cmd","node",
  "wscript","cscript","mshta","rundll32","regsvr32","bash","sh","wsl",
  "curl","wget","certutil","bitsadmin","ftp","scp","ssh","nc","ncat","telnet"
]);

let config = {
  autoAllow: false,
  autoReturnToChat: false,   // if false, results are placed in the chat box but NOT auto-sent
  allowlist: ["echo","dir","type","whoami","ver","hostname","cd","vol","where"],
  trustedFolders: [BASE_DIR]
};
if (fs.existsSync(CONFIG_FILE)) {
  try { config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch (e) {}
}

let mainWindow, settingsWindow;

// ---------- path confinement ----------
function trustedRoots() {
  const roots = (config.trustedFolders && config.trustedFolders.length) ? config.trustedFolders : [BASE_DIR];
  return roots.map(r => { try { return fs.realpathSync(r); } catch (e) { return path.resolve(r); } });
}

// Fragments that are denied outright, before any prompt (case-insensitive substring).
const SENSITIVE = [
  "\\.ssh\\", "\\.aws\\", "\\.gnupg\\", "\\.config\\gcloud", "\\.docker\\",
  "\\appdata\\local\\google\\chrome", "\\appdata\\roaming\\mozilla", "\\appdata\\local\\microsoft\\edge",
  "id_rsa", "\\.env", "\\.git\\config", "\\ntuser.dat"
];
// The bridge's own guard files may never be written/deleted via the bridge.
const GUARD_FILES = ["config.json","main.js","main.hardened.js","main.js.orig","preload.js","preload.hardened.js","preload.js.orig","settings.html"];

function isSensitive(resolved) {
  const low = resolved.toLowerCase();
  if (SENSITIVE.some(s => low.includes(s.toLowerCase()))) return true;
  if (low.startsWith(BASE_DIR.toLowerCase()) && GUARD_FILES.includes(path.basename(low))) return true;
  return false;
}

// Resolve symlinks (TOCTOU-safe-ish) for an existing path, or its nearest existing parent for a new path.
function resolveReal(p) {
  try { return fs.realpathSync(p); }
  catch (e) {
    let parent = path.dirname(p);
    try { parent = fs.realpathSync(parent); } catch (_) { parent = path.resolve(path.dirname(p)); }
    return path.join(parent, path.basename(p));
  }
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

// ---------- command parsing ----------
// Reject anything that could chain/redirect/expand in a shell, even inside quotes.
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

// Treat as a path only for real path shapes (so Windows /flags are not misread as paths).
function looksLikePath(a) {
  return a.includes("\\") || /^[A-Za-z]:/.test(a) || a.startsWith("..") || a.startsWith("/");
}

// ---------- window / menu (unchanged behaviour) ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadURL('https://chat.deepseek.com');
  mainWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  buildMenu();
}

function buildMenu() {
  const template = [{
    label: 'PC Link',
    submenu: [
      { label: 'Settings', click: () => {
          if (settingsWindow) { settingsWindow.focus(); return; }
          settingsWindow = new BrowserWindow({
            width: 500, height: 400, parent: mainWindow, autoHideMenuBar: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }  // local trusted file; left as-is to not break settings.html
          });
          settingsWindow.loadFile('settings.html');
          settingsWindow.webContents.on('did-finish-load', () => settingsWindow.webContents.send('load-settings', config));
          settingsWindow.on('closed', () => { settingsWindow = null; });
      }},
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'quit' }
    ]
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('save-settings', (event, newConfig) => {
  config = Object.assign(config, newConfig);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
});

// preload asks for config (so it knows autoReturnToChat)
ipcMain.handle('get-config', () => ({ autoReturnToChat: !!config.autoReturnToChat }));

// ---------- hardened command execution ----------
ipcMain.handle('run-command', async (event, cmd, reason) => {
  cmd = String(cmd || "");
  if (SHELL_META.test(cmd)) return "Refused: shell metacharacters (& | > < ^ % ` newline) are not allowed.";
  const argv = tokenize(cmd);
  if (!argv.length) return "Refused: empty command.";
  const name = argv[0].toLowerCase();
  if (FORBIDDEN.has(name)) return "Refused: '" + name + "' can run arbitrary code and is blocked by this bridge.";
  if (!config.allowlist.map(s => String(s).toLowerCase()).includes(name)) return "Refused: '" + name + "' is not on the allowlist.";

  // Confine any path-shaped argument to trusted folders (blocks e.g. `type C:\Users\...\.ssh\id_rsa`).
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
      title: 'Command Execution Request',
      message: 'Run this command?\n\n' + argv.join(' '),
      detail: 'Working dir: ' + BASE_DIR + '\nWhy: ' + String(reason || '').slice(0, 500)
    });
    if (response !== 0) return 'Skipped by user.';
  }

  return new Promise((resolve) => {
    // No shell. Builtins (dir/type/echo/ver/vol) + real exes both go through cmd /c with an ARGV ARRAY;
    // metacharacters were already rejected, so no chaining/redirection/expansion is possible.
    execFile('cmd', ['/d', '/s', '/c', ...argv], { cwd: BASE_DIR, timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => resolve((stdout || "") + (stderr || "") || ("Error: " + (error ? error.message : 'Unknown'))));
  });
});

// ---------- hardened file operations ----------
ipcMain.handle('file-op', async (event, action, target, content, reason) => {
  const abs = path.isAbsolute(target) ? target : path.resolve(BASE_DIR, String(target || ""));
  const chk = checkInsideTrusted(abs);
  if (!chk.ok) return "Access denied: target is " + chk.reason + ".";
  const targetPath = chk.resolved;

  if (!config.autoAllow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'File Operation Request',
      message: action.toUpperCase() + '\n\n' + targetPath,
      detail: 'Why: ' + String(reason || '').slice(0, 500)
    });
    if (response !== 0) return 'Skipped by user.';
  }

  try {
    if (action === 'write') {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf8');
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- !PHONE: forward to the existing phone-bridge (the same broker Claude uses) ----------
// Exposes the phone's command vocabulary to DeepSeek by dropping a JSON job in phone-bridge\inbox
// and reading phone-bridge\outbox, exactly like ask.py. PC / bridge-config verbs are NOT exposed here:
// PC execution must stay on the !EXEC path so there is ONE guarded control plane.
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

  if (!config.autoAllow) {
    const argstr = Object.keys(args).map(k => k + '=' + args[k]).join(' ');
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Phone Command Request',
      message: 'Send to phone?\n\n' + verb + ' ' + argstr,
      detail: 'Routed through phone-bridge'
    });
    if (response !== 0) return 'Skipped by user.';
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
        try {
          const r = JSON.parse(fs.readFileSync(outfile, 'utf8'));
          let out = _formatPhone(r);
          if (out.length > 8000) out = out.slice(0, 8000) + '\n...[truncated]';
          resolve(out);
        } catch (e) { setTimeout(tick, 150); }
        return;
      }
      if (Date.now() - t0 > timeoutMs) { resolve('No answer from phone-bridge (is phone_bridge.bat running?).'); return; }
      setTimeout(tick, 200);
    };
    tick();
  });
});
