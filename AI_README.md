# AI Guide & Lessons Learned for PC Link

If you are an AI reading this in a new chat, READ THIS FIRST to avoid hours of debugging.

## 1. Security & Sandbox Rules (HARDENED)
- NO INTERPRETERS: python, node, powershell, cmd, bash are BLOCKED in !EXEC. You cannot run arbitrary code via the shell.
- NO SHELL CHAINING: &&, |, >, < are blocked. One command at a time.
- NO TRAVERSAL: cd .. or absolute paths outside the sandbox are blocked.
- PROTECTED FILES: main.js, preload.js, config.json, and settings.html cannot be edited via !FILE. The user must edit these manually on their PC.

## 2. The Electron Bridge (!FILE and !EXEC)
- Indentation is stripped: Never write Python scripts using !FILE write if they require indented blocks. Use zero-indentation syntax (while i < 10: do_stuff(); i += 1).
- String newlines break: Passing \
 inside a Python string via !FILE write causes a literal line break, throwing an unterminated string literal error. Use chr(10) instead.
- Large files get truncated: Sending massive HTML or JS files via !FILE write hits a character limit and cuts the file in half. Write in chunks or use Base64.
- Command timeouts: Long-running commands will get killed by Node.js. If a script outputs massive text, it crashes to prevent memory overload. Break large tasks into smaller batches.

## 3. Interacting with the Android Phone (Use !PHONE)
- Do not use Python. Use the native !PHONE command. (e.g., !PHONE info, !PHONE ui, !PHONE dump_all).
- Swipe Syntax: bridge.py requires named arguments: !PHONE swipe x1=540 y1=1800 x2=540 y2=500.
- Tap Syntax: !PHONE tap x=540 y=1319.
- PREFER tapping by text: !PHONE tap_text text=Apply  (finds the element and taps its centre; survives the screen shifting; add exact=1 for exact match). Only use raw x/y when there is no text to match.
- Wait for a screen instead of guessing: after opening an app use !PHONE wait_text text=<text on the loaded screen> (default 15s, add timeout=20). Use this instead of blind !PHONE wait ms=....
- Reading text: Use !PHONE text for FULL, uncut text of the current screen (one line each, ~0.3s, no scrolling) — this replaces dump_all for reading. !PHONE ui is for when you need tap coordinates (its labels are truncated).
- Return to home: Always leave the phone on the home screen when done: !PHONE key name=home.

## 4. Creating Videos with Flowkit
- The Layout Checker Hangs: If python render.py --check hangs, the HTML/JS file is truncated or has a syntax error. It is NOT a collision loop. Verify the file ends with </html>.
- Massive Objects: Do not animate a single object to be 100,000px tall. Use logarithmic scaling to keep elements within the 1080x1920 frame.
- Long Renders: Rendering a video takes 10-20 minutes. Use --no-audio and --frames to test layouts quickly.

## 5. Configuration Changes
- If you use !FILE write config.json to add a new allowed command, the Electron app will NOT use it until the user restarts the app. Warn the user.