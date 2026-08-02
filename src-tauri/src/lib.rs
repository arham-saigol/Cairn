mod db;
mod models;
mod shortcuts;
mod windows_integration;

use db::Database;
use models::{AppSettings, Card, Section, Snapshot};
use shortcuts::ShortcutService;
use tauri::{Emitter, Manager, State, WindowEvent};
use windows_integration::{
    is_window_visible, main_window, position_rail, selected_text, window_hwnd,
    write_clipboard_text, PreviousWindow,
};

struct AppState {
    database: Database,
    previous_window: PreviousWindow,
    shortcuts: ShortcutService,
}

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<Snapshot, String> {
    state.database.bootstrap()
}

#[tauri::command]
fn create_note(
    content: String,
    section_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Card, String> {
    state.database.create_note(&content, section_id, None, None)
}

#[tauri::command]
fn create_section(name: String, state: State<'_, AppState>) -> Result<Section, String> {
    state.database.create_section(&name)
}

#[tauri::command]
fn update_card_content(
    id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<Card, String> {
    state.database.update_card_content(&id, &content)
}

#[tauri::command]
fn set_cards_completed(
    ids: Vec<String>,
    completed: bool,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state.database.set_cards_completed(&ids, completed)
}

#[tauri::command]
fn delete_cards(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.database.delete_cards(&ids)
}

#[tauri::command]
fn merge_cards(ids: Vec<String>, state: State<'_, AppState>) -> Result<Card, String> {
    state.database.merge_cards(&ids)
}

#[tauri::command]
fn move_cards(
    ids: Vec<String>,
    section_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.database.move_cards(&ids, section_id)
}

#[tauri::command]
fn reorder_cards(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.database.reorder_cards(&ids)
}

#[tauri::command]
fn save_settings(
    settings: AppSettings,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    // Register first. If Windows reports an OS-level conflict, the invalid shortcut is never saved.
    state.shortcuts.configure(&settings.global_shortcuts)?;
    let window = main_window(&app)?;
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| error.to_string())?;
    state.database.save_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    write_clipboard_text(&text)
}

#[tauri::command]
fn clear_all(state: State<'_, AppState>) -> Result<String, String> {
    state.database.clear_all()
}

#[tauri::command]
fn restore_backup(id: String, state: State<'_, AppState>) -> Result<Snapshot, String> {
    state.database.restore_backup(&id)
}

#[tauri::command]
fn capture_selection(state: State<'_, AppState>) -> Result<Card, String> {
    let (text, source) = selected_text()?;
    state.previous_window.set(source.hwnd);
    state
        .database
        .create_note(&text, None, source.process, source.title)
}

#[tauri::command]
fn show_rail(
    focus_input: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = main_window(&app)?;
    let cairn_hwnd = window_hwnd(&window).ok();
    let anchor = state.previous_window.remember(cairn_hwnd);
    position_rail(&window, anchor)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if focus_input {
        app.emit("focus-new-card", ())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_rail(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = main_window(&app)?;
    if is_window_visible(&window) {
        window.hide().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let cairn_hwnd = window_hwnd(&window).ok();
    let anchor = state.previous_window.remember(cairn_hwnd);
    position_rail(&window, anchor)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_rail(app: tauri::AppHandle) -> Result<(), String> {
    main_window(&app)?.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_previous_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = main_window(&app)?;
    window.hide().map_err(|error| error.to_string())?;
    if let Err(error) = state.previous_window.restore() {
        let _ = window.show();
        let _ = window.set_focus();
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
fn toggle_always_on_top(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let mut settings = state.database.bootstrap()?.settings;
    settings.always_on_top = !settings.always_on_top;
    main_window(&app)?
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| error.to_string())?;
    state.database.save_settings(&settings)?;
    Ok(settings.always_on_top)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            let database = Database::open(&data_directory.join("cairn.sqlite3"))
                .map_err(std::io::Error::other)?;
            let snapshot = database.bootstrap().map_err(std::io::Error::other)?;
            let previous_window = PreviousWindow::default();
            if let Some(window) = app.get_webview_window("main") {
                let cairn_hwnd = window_hwnd(&window).ok();
                let anchor = previous_window.remember(cairn_hwnd);
                let _ = position_rail(&window, anchor);
                window.set_always_on_top(snapshot.settings.always_on_top)?;
            }
            let shortcuts = ShortcutService::start(app.handle().clone(), &snapshot.settings)
                .map_err(std::io::Error::other)?;
            app.manage(AppState {
                database,
                previous_window,
                shortcuts,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            create_note,
            create_section,
            update_card_content,
            set_cards_completed,
            delete_cards,
            merge_cards,
            move_cards,
            reorder_cards,
            save_settings,
            copy_text,
            clear_all,
            restore_backup,
            capture_selection,
            show_rail,
            toggle_rail,
            hide_rail,
            restore_previous_window,
            toggle_always_on_top,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
