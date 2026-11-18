# DeepSeek PC Link - AI Skill File

## Your Environment
You are connected to a local Windows PC via a custom Electron bridge, and through it to an Android phone.
The primary sandbox directory is C:\Users\Espada\Documents\Deepseek_pclink. The user may add other
Trusted Folders via Settings. Every command below is subject to a human Approve/Cancel prompt.

You can output multiple commands in one response; they run sequentially and you get ALL results back in one reply. Each command is one line.

**Commands must be on their own PLAIN LINES — never inside ``` code blocks (fenced commands are ignored).**

**PREFER BATCHING.** When you already know the steps, send them together in ONE reply instead of one-at-a-time (send → wait → send). Only split across replies when a command's input depends on the OUTPUT of a previous one (e.g. you must read the screen before choosing raw x/y coordinates). Self-contained steps — home, open app, wait_text, tap_text, text, file writes — should all go in a single batch.

Good batch (one reply):
!PHONE key name=home
!PHONE tap_text text=Indeed
!PHONE wait_text text=Search
!PHONE text

---

## 1. Shell commands — `!EXEC <command> :: <reason>`
Runs a Windows command. **Hardened rules (read these or your commands will be refused):**
- **Allowlist only.** The first word must be on the allowlist (default: echo, dir, type, whoami, ver,
  hostname, cd, vol, where). Ask the user to add more if needed.
- **No shell operators.** `&  |  >  <  ^  %  ` (backtick) and newlines are rejected. You CANNOT chain
  commands, pipe, redirect, or expand %VARS%. One action per `!EXEC`.
- **No interpreters / launchers.** `python`, `start`, `powershell`, `cmd`, `node`, `curl`, `wget`, etc.
  are blocked outright. Do NOT try to run Python — see the phone section below for how to control the phone.
- **Paths are confined.** Any path argument must resolve inside a Trusted Folder. Reading things like
  C:\Users\...\.ssh\id_rsa is refused.
Example: `!EXEC dir :: list the project folder`

## 2. File operations — `!FILE <action> <target> [content] :: <reason>`
Actions: `write`, `read`, `list`, `delete`. `target` is relative to the sandbox (or any Trusted Folder).
- `!FILE list . :: see what's here`
- `!FILE read notes.txt :: read my notes`
- `!FILE write out.txt Hello world :: save a note`   (use chr(10)-style content rules from the README)
Confined to Trusted Folders; sensitive paths and the bridge's own files are blocked.
- **Added (non-sandbox) Trusted Folders:** reach them by the folder's NAME as the first path segment, e.g. `!FILE list Your_Turn` or `!FILE write Your_Turn\\notes.txt ...`, OR by full absolute path. A bare relative name with no matching folder goes to the main sandbox.

## 3. Phone control — `!PHONE <verb> key=value ... :: <reason>`  ← use this, NOT Python
Forwards to the phone-bridge (the same mechanism Claude uses). No Python, no adb needed.
Values that look like numbers are sent as numbers. One verb per line; re-check the screen after actions.

Verbs:
- `!PHONE ui`                         → list on-screen text elements with tap coordinates (your main "see" tool)
- `!PHONE text`                       → FULL, UNCUT text on screen, one line each, no scroll, ~0.3s (prefer this over `ui` when you need to READ, e.g. a full job description)
- `!PHONE tap_text text=Eiffel Tower` → find that text/desc on screen and tap its centre (no coordinate guessing; add `exact=1` for exact match)
- `!PHONE wait_text text=Search messages` → pause until that text appears (default 15s, add `timeout=20`), then continue — use INSTEAD of blind `wait ms=...` after opening an app
- `!PHONE shot`                       → take a screenshot (saved on the PC; you get a path, not the image)
- `!PHONE tap text=Settings`          → tap an element by its text/desc (preferred over coordinates)
- `!PHONE tap x=540 y=686`            → tap raw coordinates
- `!PHONE long_tap x=540 y=686`
- `!PHONE type text=hello world`      → type into the focused field
- `!PHONE key name=home`              → press home / back / enter (name=home|back|enter|...)
- `!PHONE swipe x1=540 y1=1600 x2=540 y2=600`   → scroll/swipe
- `!PHONE app_start pkg=com.indeed.android.jobsearch`
- `!PHONE app_stop pkg=...`
- `!PHONE apps filter=indeed`         → find installed packages
- `!PHONE open_url url=https://example.com`
- `!PHONE notifications`              → read notifications
- `!PHONE shell shell=pidof com.indeed.android.jobsearch`   → raw adb shell on the phone
- `!PHONE push local=<file> remote=/sdcard/x` / `!PHONE pull remote=/sdcard/x`   → move files on/off the phone
- `!PHONE wait ms=3000`

Typical loop: `!PHONE ui` to see the screen → decide → `!PHONE tap ...` / `type` / `swipe` → `!PHONE ui` again to confirm.

Not available via !PHONE (by design): `pc`, `restart`, `startup`, `tcpip`, `net`. These run on the PC or
reconfigure the bridge — use `!EXEC` for PC work.
