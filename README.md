# DeepSeek PC Link

An Electron desktop app that lets **DeepSeek** (running in its web UI) control your Windows PC and an
Android phone, with a human approval gate. The app loads `chat.deepseek.com`, watches the assistant's
replies for command lines, runs them locally, and feeds the results back into the chat.

> ⚠️ **This tool runs commands on your machine based on text from a web page.** Read the Security section
> before using it. Use at your own risk, on your own device.

## What it can do
DeepSeek issues commands by writing these on their own lines (see `AI_SKILL.md` for the full spec):

- `!EXEC <command> :: <reason>` — run an **allow-listed** Windows command (no shell chaining, no interpreters).
- `!FILE <read|write|list|delete> <target> :: <reason>` — file ops confined to your Trusted Folders.
- `!PHONE <verb> key=value :: <reason>` — drive an Android phone via the companion
  [phone-bridge](../phone-bridge) (tap, type, swipe, read screen, etc.).

## Security model
- **Allowlist**, not blocklist, for `!EXEC`. Interpreters (`python`, `powershell`, `node`, …) and shell
  operators (`& | > %`) are blocked, so a single command can't chain into arbitrary code.
- **Path confinement**: every file/path argument is resolved (symlinks included) and must stay inside your
  Trusted Folders. Sensitive paths (`.ssh`, `.aws`, browser profiles, `.env`, …) are blocked outright.
- **Guard files**: the app cannot overwrite its own `main.js` / `preload.js` / `config.json` / `settings.html`.
- **Human approval** on every action (`autoAllow` can disable this — see below).
- This is **application-level** sandboxing. It is not OS-level isolation; treat it accordingly.

## Setup
```bash
cd DeepApp
npm install
copy ..\config.example.json ..\config.json   # then edit config.json (paths, optional Telegram)
npm start
```
Also start the companion **phone-bridge** if you want `!PHONE` commands.

## Configuration (`config.json`, git-ignored)
| Key | Meaning |
|-----|---------|
| `autoAllow` | Skip all approval popups (full hands-free — risky; leave `false` unless you mean it). |
| `autoAllowPhone` | Auto-approve only `!PHONE`; PC commands still prompt. |
| `autoReturnToChat` | Auto-send results back to the chat instead of waiting for you to press Enter. |
| `autoRefresh` | Reload the page periodically to catch messages sent from the DeepSeek mobile app. |
| `allowlist` | Allowed `!EXEC` command names. |
| `trustedFolders` | Folders `!FILE` / path args may touch. |
| `telegramToken` / `telegramChatId` | Optional: toggle `autoAllow` / `autoRefresh` remotely via a Telegram bot. |

## ⚠️ Security notes before you fork/run
- **Never commit `config.json`** — it holds local paths and your Telegram bot token. It is git-ignored; a
  template is in `config.example.json`.
- If you enable the Telegram bot, your Telegram account becomes a remote switch for `autoAllow` — keep it secure.
- `autoAllow = true` is genuinely full access to allow-listed commands + your Trusted Folders, unattended.
