use crate::models::{AppSettings, GlobalShortcutEvent};
use parking_lot::Mutex;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{mpsc, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL,
            MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, VIRTUAL_KEY, VK_CONTROL, VK_DELETE, VK_DOWN,
            VK_ESCAPE, VK_F1, VK_LCONTROL, VK_LEFT, VK_LMENU, VK_LSHIFT, VK_MENU, VK_OEM_COMMA,
            VK_OEM_PERIOD, VK_RCONTROL, VK_RETURN, VK_RIGHT, VK_RMENU, VK_RSHIFT, VK_SHIFT,
            VK_SPACE, VK_TAB, VK_UP,
        },
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetMessageW, PeekMessageW, PostThreadMessageW,
            SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT,
            MSG, PM_NOREMOVE, PM_REMOVE, WH_KEYBOARD_LL, WM_APP, WM_HOTKEY, WM_KEYDOWN, WM_KEYUP,
            WM_SYSKEYDOWN, WM_SYSKEYUP,
        },
    },
};

const DOUBLE_TAP_WINDOW: Duration = Duration::from_millis(420);
const WM_CAIRN_WAKE: u32 = WM_APP + 1;

enum ServiceCommand {
    Configure(
        BTreeMap<String, Option<String>>,
        mpsc::SyncSender<Result<(), String>>,
    ),
    Stop,
}

pub struct ShortcutService {
    sender: mpsc::Sender<ServiceCommand>,
    thread_id: u32,
}

impl ShortcutService {
    pub fn start(app: AppHandle, settings: &AppSettings) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("cairn-shortcuts".into())
            .spawn(move || shortcut_loop(app, receiver, ready_sender))
            .map_err(|error| error.to_string())?;
        let thread_id = ready_receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "The global shortcut service did not start in time.".to_string())?;
        let service = Self { sender, thread_id };
        if let Err(error) = service.configure(&settings.global_shortcuts) {
            eprintln!("Global shortcuts are disabled until they are reconfigured: {error}");
        }
        Ok(service)
    }

    pub fn configure(&self, shortcuts: &BTreeMap<String, Option<String>>) -> Result<(), String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        self.sender
            .send(ServiceCommand::Configure(shortcuts.clone(), sender))
            .map_err(|_| "The global shortcut service is not running.".to_string())?;
        self.wake()?;
        receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "The global shortcut service did not respond.".to_string())?
    }

    fn wake(&self) -> Result<(), String> {
        unsafe { PostThreadMessageW(self.thread_id, WM_CAIRN_WAKE, WPARAM(0), LPARAM(0)) }
            .map_err(|error| error.to_string())
    }
}

impl Drop for ShortcutService {
    fn drop(&mut self) {
        let _ = self.sender.send(ServiceCommand::Stop);
        let _ = self.wake();
    }
}

struct TapState {
    actions: HashMap<u32, String>,
    pressed: HashSet<u32>,
    chorded: HashSet<u32>,
    last_release: Option<(u32, Instant)>,
    sender: mpsc::Sender<String>,
    thread_id: u32,
}

static TAP_STATE: OnceLock<Mutex<TapState>> = OnceLock::new();

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let event = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let key = canonical_modifier(event.vkCode);
        if let Some(state) = TAP_STATE.get() {
            let mut state = state.lock();
            let key_down = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
            let key_up = wparam.0 as u32 == WM_KEYUP || wparam.0 as u32 == WM_SYSKEYUP;
            if let Some(key) = key {
                if key_down {
                    if !state.pressed.contains(&key) {
                        let has_other_modifier = !state.pressed.is_empty();
                        if has_other_modifier {
                            let pressed = state.pressed.iter().copied().collect::<Vec<_>>();
                            state.chorded.extend(pressed);
                            state.chorded.insert(key);
                        } else {
                            state.chorded.remove(&key);
                        }
                        state.pressed.insert(key);
                    }
                } else if key_up && state.pressed.remove(&key) {
                    if state.chorded.remove(&key) {
                        state.last_release = None;
                    } else {
                        let now = Instant::now();
                        if state.last_release.is_some_and(|(previous, at)| {
                            previous == key && now.duration_since(at) <= DOUBLE_TAP_WINDOW
                        }) {
                            if let Some(action) = state.actions.get(&key).cloned() {
                                let _ = state.sender.send(action);
                                let _ = PostThreadMessageW(
                                    state.thread_id,
                                    WM_CAIRN_WAKE,
                                    WPARAM(0),
                                    LPARAM(0),
                                );
                            }
                            state.last_release = None;
                        } else {
                            state.last_release = Some((key, now));
                        }
                    }
                }
            } else if key_down {
                let pressed = state.pressed.iter().copied().collect::<Vec<_>>();
                state.chorded.extend(pressed);
                state.last_release = None;
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn shortcut_loop(
    app: AppHandle,
    receiver: mpsc::Receiver<ServiceCommand>,
    ready: mpsc::SyncSender<u32>,
) {
    let thread_id = unsafe { GetCurrentThreadId() };
    let mut initial_message = MSG::default();
    unsafe {
        let _ = PeekMessageW(&mut initial_message, None, 0, 0, PM_NOREMOVE);
    }
    let (tap_sender, tap_receiver) = mpsc::channel();
    let _ = TAP_STATE.set(Mutex::new(TapState {
        actions: HashMap::new(),
        pressed: HashSet::new(),
        chorded: HashSet::new(),
        last_release: None,
        sender: tap_sender,
        thread_id,
    }));
    let _ = ready.send(thread_id);
    let module = unsafe { GetModuleHandleW(None).ok() };
    let hook = module.and_then(|module| unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook),
            Some(HINSTANCE(module.0)),
            0,
        )
        .ok()
    });
    let mut active = BTreeMap::new();
    let mut registrations: HashMap<i32, String> = HashMap::new();
    let mut running = true;

    while running {
        while let Ok(command) = receiver.try_recv() {
            match command {
                ServiceCommand::Configure(next, response) => {
                    let result =
                        configure_shortcuts(&next, &active, &mut registrations, hook.is_some());
                    if result.is_ok() {
                        active = next;
                    }
                    let _ = response.send(result);
                }
                ServiceCommand::Stop => running = false,
            }
        }

        while let Ok(action) = tap_receiver.try_recv() {
            let _ = app.emit("global-shortcut", GlobalShortcutEvent { action });
        }
        if !running {
            break;
        }

        let mut message = MSG::default();
        let received = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if received.0 <= 0 {
            break;
        }
        dispatch_message(&app, &registrations, &message);
        unsafe {
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                dispatch_message(&app, &registrations, &message);
            }
        }
    }

    unregister_all(&registrations);
    if let Some(hook) = hook {
        unsafe {
            let _ = UnhookWindowsHookEx(hook);
        }
    }
}

fn dispatch_message(app: &AppHandle, registrations: &HashMap<i32, String>, message: &MSG) {
    if message.message == WM_HOTKEY {
        if let Some(action) = registrations.get(&(message.wParam.0 as i32)) {
            let _ = app.emit(
                "global-shortcut",
                GlobalShortcutEvent {
                    action: action.clone(),
                },
            );
        }
    } else if message.message != WM_CAIRN_WAKE {
        unsafe {
            let _ = TranslateMessage(message);
            DispatchMessageW(message);
        }
    }
}

fn configure_shortcuts(
    next: &BTreeMap<String, Option<String>>,
    previous: &BTreeMap<String, Option<String>>,
    registrations: &mut HashMap<i32, String>,
    hook_available: bool,
) -> Result<(), String> {
    unregister_all(registrations);
    registrations.clear();
    if let Some(state) = TAP_STATE.get() {
        let mut state = state.lock();
        state.actions.clear();
        state.pressed.clear();
        state.chorded.clear();
        state.last_release = None;
    }

    match register_map(next, registrations, hook_available) {
        Ok(()) => Ok(()),
        Err(error) => {
            unregister_all(registrations);
            registrations.clear();
            if let Some(state) = TAP_STATE.get() {
                let mut state = state.lock();
                state.actions.clear();
                state.pressed.clear();
                state.chorded.clear();
                state.last_release = None;
            }
            let _ = register_map(previous, registrations, hook_available);
            Err(error)
        }
    }
}

fn register_map(
    shortcuts: &BTreeMap<String, Option<String>>,
    registrations: &mut HashMap<i32, String>,
    hook_available: bool,
) -> Result<(), String> {
    for (index, (action, value)) in shortcuts.iter().enumerate() {
        let Some(value) = value else { continue };
        if let Some(modifier) = value.strip_prefix("DoubleTap:") {
            if !hook_available {
                return Err("Windows could not start modifier double-tap detection.".into());
            }
            let key = match modifier {
                "Ctrl" => VK_CONTROL.0 as u32,
                "Alt" => VK_MENU.0 as u32,
                "Shift" => VK_SHIFT.0 as u32,
                _ => return Err(format!("{value} is not a supported double-tap shortcut.")),
            };
            if let Some(state) = TAP_STATE.get() {
                state.lock().actions.insert(key, action.clone());
            }
            continue;
        }

        let (modifiers, key) = parse_shortcut(value)?;
        let id = 0xCA10 + index as i32;
        unsafe {
            RegisterHotKey(None, id, modifiers | MOD_NOREPEAT, key.0 as u32).map_err(|_| {
                format!(
                    "{value} is already used by Windows or another app. Choose a different shortcut."
                )
            })?;
        }
        registrations.insert(id, action.clone());
    }
    Ok(())
}

fn unregister_all(registrations: &HashMap<i32, String>) {
    for id in registrations.keys() {
        unsafe {
            let _ = UnregisterHotKey(None, *id);
        }
    }
}

fn parse_shortcut(value: &str) -> Result<(HOT_KEY_MODIFIERS, VIRTUAL_KEY), String> {
    let parts: Vec<_> = value.split('+').collect();
    let mut modifiers = HOT_KEY_MODIFIERS(0);
    let mut key = None;
    for part in parts {
        match part {
            "Ctrl" => modifiers |= MOD_CONTROL,
            "Alt" => modifiers |= MOD_ALT,
            "Shift" => modifiers |= MOD_SHIFT,
            "Win" => modifiers |= MOD_WIN,
            value => key = Some(parse_key(value)?),
        }
    }
    key.map(|key| (modifiers, key))
        .ok_or_else(|| "A global shortcut needs a non-modifier key.".into())
}

fn parse_key(value: &str) -> Result<VIRTUAL_KEY, String> {
    if value.len() == 1 {
        let character = value.chars().next().unwrap();
        if character.is_ascii_alphanumeric() {
            return Ok(VIRTUAL_KEY(character.to_ascii_uppercase() as u16));
        }
    }
    if let Some(number) = value
        .strip_prefix('F')
        .and_then(|number| number.parse::<u16>().ok())
    {
        if (1..=24).contains(&number) {
            return Ok(VIRTUAL_KEY(VK_F1.0 + number - 1));
        }
    }
    match value {
        "Space" => Ok(VK_SPACE),
        "Enter" => Ok(VK_RETURN),
        "Tab" => Ok(VK_TAB),
        "Escape" => Ok(VK_ESCAPE),
        "Delete" => Ok(VK_DELETE),
        "Up" => Ok(VK_UP),
        "Down" => Ok(VK_DOWN),
        "Left" => Ok(VK_LEFT),
        "Right" => Ok(VK_RIGHT),
        "." => Ok(VK_OEM_PERIOD),
        "," => Ok(VK_OEM_COMMA),
        _ => Err(format!(
            "{value} is not supported as a global shortcut key."
        )),
    }
}

fn canonical_modifier(key: u32) -> Option<u32> {
    match key {
        value if [VK_CONTROL, VK_LCONTROL, VK_RCONTROL].contains(&VIRTUAL_KEY(value as u16)) => {
            Some(VK_CONTROL.0 as u32)
        }
        value if [VK_MENU, VK_LMENU, VK_RMENU].contains(&VIRTUAL_KEY(value as u16)) => {
            Some(VK_MENU.0 as u32)
        }
        value if [VK_SHIFT, VK_LSHIFT, VK_RSHIFT].contains(&VIRTUAL_KEY(value as u16)) => {
            Some(VK_SHIFT.0 as u32)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_shortcuts() {
        let (modifiers, key) = parse_shortcut("Ctrl+Alt+Shift+Enter").unwrap();
        assert!(modifiers.contains(MOD_CONTROL));
        assert!(modifiers.contains(MOD_ALT));
        assert!(modifiers.contains(MOD_SHIFT));
        assert_eq!(key, VK_RETURN);
    }

    #[test]
    fn supports_function_keys() {
        assert_eq!(parse_key("F24").unwrap().0, VK_F1.0 + 23);
    }
}
