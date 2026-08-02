# Cairn

Cairn is a private Windows work rail: a local scratchpad, clipboard, and task list built with Tauri 2, Rust, React, TypeScript, Tailwind CSS, shadcn/ui-style primitives, SQLite, and the Rust `windows` crate.

It has no accounts, telemetry, cloud sync, AI API, or network-backed data feature. Notes, settings, capture metadata, and recoverable clear backups stay in one local SQLite database.

## Implementation plan

1. Keep storage and Windows integration behind a small Rust command surface.
2. Keep card selection and keyboard interaction immediate in React, persisting every mutation to SQLite.
3. Prefer Windows UI Automation, with a guarded clipboard-preserving fallback for applications that do not expose a text pattern.
4. Verify the web interaction layer, Rust transactions, native hotkeys, embedded desktop build, and installer build separately.

## Prerequisites

- Windows 10 or Windows 11
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload
- [Rust stable (MSVC)](https://rustup.rs/)
- Node.js 22 or newer and npm
- Microsoft Edge WebView2 Runtime (included with current Windows releases; the installer can download its bootstrapper when needed)

## Install and run

```powershell
npm install
npm run tauri:dev
```

The Vite development server uses port `1420`. If another local service owns that port, stop it before starting `tauri:dev`.

To create Windows installers:

```powershell
npm run tauri:build
```

The MSI and NSIS outputs are written under `src-tauri/target/release/bundle/`. Local unsigned builds may show the normal Windows publisher warning.

## Everyday use

- Type a note, prompt, or task into the composer and press `Enter`.
- Type `# Section Name` in the composer to create a section. Use the section control inside Search to filter the rail.
- Select a card with a click. Use `Ctrl+click` to toggle cards and `Shift+click` or `Shift+Arrow` to extend a range.
- Drag the grip to reorder cards, or focus cards with the arrow keys.
- Double-click a card or press `F2` to edit it. `Ctrl+Enter` saves an inline edit.
- The card menu supports copy, copy and complete, edit, merge, move, completion, and deletion.
- `Ctrl+C` copies selected cards in visible order. Multiple cards are separated by one blank line, with no source metadata.
- `Ctrl+Shift+C` copies first, then completes only the cards that changed. Its toast offers Undo.
- Clear is always a two-step action. Cairn keeps the ten most recent clear backups locally and offers immediate Restore.

Captured cards show the source process and capture time. The source window title and full creation timestamp are retained in SQLite and exposed in the card metadata tooltip.

## Default global shortcuts

These work from other Windows applications and can be changed immediately in **Menu → Keybindings**.

| Command                        | Default                |
| ------------------------------ | ---------------------- |
| Show or hide Cairn             | `Ctrl+Alt+Space`       |
| Capture selected text          | `Ctrl+Alt+G`           |
| Open Cairn and add a card      | `Ctrl+Alt+N`           |
| Copy selected cards and return | `Ctrl+Alt+Enter`       |
| Copy, complete, and return     | `Ctrl+Alt+Shift+Enter` |
| Toggle always on top           | `Ctrl+Alt+P`           |
| Clear all content              | Not set                |

The recorder accepts ordinary combinations and global double-taps of Ctrl, Alt, or Shift. It blocks duplicate, Windows-reserved, unsupported, and unsafe unmodified global shortcuts. If another application already owns a valid-looking shortcut, the Rust service restores the previous registration set and rejects the change.

## Fixed in-app shortcuts

| Shortcut       | Action                                                        |
| -------------- | ------------------------------------------------------------- |
| `Ctrl+C`       | Copy selected cards without completing them                   |
| `Ctrl+Shift+C` | Copy, then complete after success                             |
| `Ctrl+A`       | Select all cards in the current filter/search                 |
| `Ctrl+K`       | Focus Search                                                  |
| `Ctrl+N`       | Focus the composer                                            |
| `Space`        | Toggle selected cards when not editing text                   |
| `Delete`       | Open the selected-card delete confirmation                    |
| `Escape`       | Cancel edit, clear selection, close an overlay, or hide Cairn |
| Arrow keys     | Move card/menu focus; hold Shift to extend selection          |

Merge, edit, and move-to-section commands are separately configurable. Standard editing shortcuts remain read-only so text fields behave like other Windows applications.

## Text capture and focus behavior

1. Cairn records the foreground HWND, executable name, and title.
2. It asks Windows UI Automation for the focused element's selected text.
3. If the application does not expose a UIA text pattern, a dedicated STA worker snapshots the OLE clipboard, waits for the capture hotkey modifiers to be released, sends `Ctrl+C`, and rejects the result unless the clipboard sequence changes.
4. It restores the original rich clipboard object, with a Unicode-text safety snapshot for short-lived clipboard providers.
5. The rail is placed against the work area of the source window's monitor and can return focus to the saved HWND after global copy actions.

Windows prevents lower-integrity processes from automating elevated applications. Cairn deliberately does not bypass that security boundary; capture from elevated applications requires Cairn to run at matching integrity, which is generally not recommended for routine use.

## Local data

The database is stored at:

```text
%APPDATA%\dev.cairn.desktop\cairn.sqlite3
```

SQLite uses WAL mode, foreign keys, and transactional batch operations. Clear backups are records in the same local database. To reset an installation manually, exit Cairn before removing that database and its `-wal`/`-shm` companions.

## Quality checks

```powershell
npm run check
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --all-targets --manifest-path src-tauri/Cargo.toml
npm run build
```

## Interaction references and licensing

Cairn uses original implementation code. The reference review informed timing and restraint, not visual copying:

- [interior.dev](https://www.interior.dev/) — its public component repository is MIT licensed; Cairn follows its principles of reserving space, treating keyboard behavior as complete behavior, and skipping travel under reduced motion.
- [Transitions.dev](https://transitions.dev/) — used only as guidance for small transform/opacity transitions, open/close asymmetry, and `prefers-reduced-motion`. No showcase snippet was copied.
- [metal-fx](https://metal.jakubantalik.com/) — the package is MIT licensed, but Cairn intentionally does not include the WebGL effect because it would reduce clarity and increase idle rendering cost for a desktop utility.

See [Architecture](docs/ARCHITECTURE.md) for the internal boundaries and safety invariants.
