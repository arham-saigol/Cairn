# Cairn architecture

## Boundaries

```text
React rail
  ├─ keyboard, selection, menus, dialogs, motion, optimistic view state
  └─ typed commands/events
       ↓
Tauri command surface
  ├─ SQLite database (cards, sections, settings, backups)
  ├─ Win32 window/focus/monitor integration
  ├─ UI Automation + clipboard-preserving capture
  └─ dedicated hotkey/message-loop thread + low-level modifier hook
```

The webview never opens the database directly and has no network or file-system capability. Tauri commands expose only product operations, which keeps mutation rules testable and prevents SQL or arbitrary paths from entering the frontend.

## Storage

`Database` owns a single `rusqlite::Connection` behind a `parking_lot::Mutex`. This is intentionally simpler than a connection pool for a one-window utility. WAL mode keeps reads responsive, while multi-card completion, move, reorder, merge, clear, and restore operations use transactions.

Cards store:

- content and completion state;
- nullable section ID and stable sort order;
- source process and source window title;
- creation and update timestamps.

Sections are first-class rows rather than marker cards. The composer translates `# Name` into a section creation command. Clear stores cards and sections as a JSON backup inside SQLite before deleting content; settings are never cleared.

## Copy invariants

`copyCards` builds plain text from cards in their stored display order. It awaits the Rust clipboard command before requesting any completion changes. The database returns only IDs whose completion state actually changed, so Undo cannot reopen a card that was already complete before copying.

## Shortcut service

Win32 `RegisterHotKey` calls and their `WM_HOTKEY` message pump live on one dedicated thread, which is required because hotkeys belong to the registering thread. Reconfiguration is transactional:

1. unregister the current set;
2. attempt the proposed set;
3. on any OS collision, remove the partial proposal and restore the previous set;
4. persist settings only after successful registration.

Modifier double-taps use a `WH_KEYBOARD_LL` hook. The callback observes only Ctrl, Alt, and Shift transitions, emits configured actions, and always passes input to `CallNextHookEx`; it does not suppress or log keystrokes.

## Capture path

UI Automation is preferred because it does not disturb the clipboard. The fallback runs on a fresh STA thread so OLE clipboard APIs have a valid apartment even when the Tauri invoke thread is MTA-initialized. It waits for global-shortcut modifiers to lift before sending `Ctrl+C`, polls the clipboard sequence number, and refuses unchanged/stale content. Restoration happens before the capture result is returned.

## Window behavior

The Tauri window is transparent, undecorated, 388×720 physical pixels by default, resizable within narrow-rail limits, and topmost by default. Before showing, Cairn records the non-Cairn foreground HWND and places itself 12 pixels inside that window's monitor work area. Copy-and-return hides Cairn before calling `SetForegroundWindow`; if Windows declines the focus request, Cairn reappears so the action does not strand the user.

## Frontend test mode

Outside Tauri, `src/api.ts` provides a localStorage-backed implementation of the same operations. `?demo=1` supplies representative cards only when the browser store is empty. This path exists for component and keyboard workflow verification; the desktop build always uses SQLite.
