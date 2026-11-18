# EXPERIENCE.md — where the tools silently lie

The README tells you what the commands are. This file tells you where they behave in surprising ways,
with symptom → cause → fix. **If a screen doesn't match expectations, or a command returns `ok:true` but
nothing changed, read this before concluding a feature doesn't exist.** Several hours have been lost to
exactly that wrong conclusion.

## Rule 0 — When confused about a FORM, use `!PHONE ui`, not `!PHONE text`
`text` lists visible strings. An **empty** input has no string, so it is easy to misread "the field isn't
there." `ui` shows every node, including empty `EditText`s (flagged `E`), with tap coordinates.
(`text` now also prints `[empty input #id]` lines for empty fields, but `ui` is still the source of truth
for editing; the `[empty input]` marker is verified working.)

## Rule 1 — `set_text` targets the FIRST EditText by default; pass `index=` to pick another
`!PHONE set_text text=Foo` writes to `EditText instance=0` (the first on screen). It does **not** know which
field you tapped. To target a specific field: `!PHONE set_text text=Foo index=2`. It returns `now=<field's
text after writing>` — **check `now`**, not just `ok:true`, to confirm the value landed where you meant.
When in doubt, tap the field, confirm focus with `ui`, then `type` (which respects focus).

## Rule 2 — `type` respects focus, `set_text` does not
`!PHONE type text=Foo` types into whatever field currently has focus. So: tap/focus the field, verify with
`ui` (or that the keyboard appeared), then `type`. Use `set_text index=` when you want to overwrite a field
wholesale without keyboard/backspace games.

## Rule 3 — Never `!PHONE key name=enter` to commit a field
It often **blanks** the field. Commit by tapping the suggestion row, the Save button, or the next field.

## Rule 4 — Upload one file per round-trip
Push file A → upload A → verify → push file B → upload B. Never push two images then pick by position: the
photo picker shows no filenames and tile order is not guaranteed to match push order. The crop/preview
screen *does* show the image — look at it before tapping Done.

## Rule 5 — `push local=` wants a FULL absolute Windows path
A relative `local=` resolves inside `phone-bridge\files\`, not your folder. Use the full path, e.g.
`!PHONE push local=C:\Users\...\Your_Turn\file.png remote=/sdcard/Pictures/file.png`.

## Rule 6 — Coordinates from `ui` go stale on reflow
If the form scrolls or a spinner opens, re-read `ui` before the next tap. A tap at a stale y-coordinate
silently hits the wrong element — and still returns `ok:true`.

## Rule 7 — `tap_text` matches a text LABEL before an input (confirmed)
`tap_text` searches in order: text → textContains → description. So a `TextView` showing the label gets matched
and tapped BEFORE the `EditText` that only carries that string as a content-desc — and tapping a label does not
focus the input. When focus matters: tap the field's bounds from `ui`, wait ~800ms, confirm focus with `ui`,
then `type` (which respects focus — verified live).

## Rule 8 — `shell`'s arg key is `shell` (not `cmd`)
`!PHONE shell shell="ls -l /sdcard/Pictures"`. Using `cmd=` fails. Handy for checking file
existence/size/cleanup before/after a push or pull.

## Rule 9 — Verify committed STATE, not the success toast
"Saved successfully" means the request went through, not that the right value did. Re-read the profile/form
after saving anything important. (Some apps also cache the old value in the view after a successful change.)

## Rule 10 — LinkedIn app specifics
Open from the app drawer, not the home screen. Headline lives in **Edit intro** as an *unlabelled* EditText.
Industry is required by that form. Custom URL: Edit contact info → profile URL → webview. The profile view
caches — an old value can display briefly after a successful change.

## Rule 11 — The replay loop (now fixed, kept as a tripwire)
This used to happen: identical command IDs returning repeatedly, old commands re-executing after an
auto-refresh. The runner now runs each reply exactly once, so it should not recur. If you ever DO see
identical IDs replaying, stop sending commands and tell the user — something is re-scanning history.
