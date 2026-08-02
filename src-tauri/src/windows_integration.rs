use std::{
    mem::size_of,
    path::Path,
    ptr,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, PhysicalSize, WebviewWindow};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, GlobalFree, HANDLE, HGLOBAL, HWND},
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
                OpenClipboard, SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
            Ole::{
                OleFlushClipboard, OleGetClipboard, OleInitialize, OleSetClipboard,
                OleUninitialize, CF_UNICODETEXT,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
            },
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_KEYUP, VK_C, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
            },
            WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
                GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
                SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE,
            },
        },
    },
};

const RAIL_MARGIN: i32 = 24;
const RAIL_OFFSET: i32 = 12;
const MIN_RAIL_WIDTH: i32 = 340;
const MIN_RAIL_HEIGHT: i32 = 480;
const UIA_TIMEOUT: Duration = Duration::from_millis(1500);
static UIA_WORKER_ACTIVE: AtomicBool = AtomicBool::new(false);
static CLIPBOARD_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
const UIA_BUSY_ERROR: &str = "A previous UI Automation capture is still running.";

struct UiaWorkerGuard;

impl Drop for UiaWorkerGuard {
    fn drop(&mut self) {
        UIA_WORKER_ACTIVE.store(false, Ordering::Release);
    }
}

struct ClipboardCaptureGuard;

impl Drop for ClipboardCaptureGuard {
    fn drop(&mut self) {
        CLIPBOARD_CAPTURE_ACTIVE.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone)]
pub struct SourceContext {
    pub hwnd: HWND,
    pub process: Option<String>,
    pub title: Option<String>,
}

// HWND values are opaque process-local handles. The wrapper makes the stored value explicit and
// keeps raw Win32 handles out of the cross-thread application state.
#[derive(Default)]
pub struct PreviousWindow(parking_lot::Mutex<Option<(usize, u32)>>);

impl PreviousWindow {
    pub fn remember(&self, cairn_hwnd: Option<HWND>) -> Option<HWND> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0.is_null() || cairn_hwnd.is_some_and(|window| window == foreground) {
            return self.get();
        }
        if let Some(identity) = window_identity(foreground) {
            *self.0.lock() = Some(identity);
        }
        Some(foreground)
    }

    pub fn set(&self, hwnd: HWND) {
        if !hwnd.0.is_null() {
            if let Some(identity) = window_identity(hwnd) {
                *self.0.lock() = Some(identity);
            }
        }
    }

    pub fn get(&self) -> Option<HWND> {
        self.0
            .lock()
            .map(|(value, _)| HWND(value as *mut std::ffi::c_void))
    }

    pub fn restore(&self) -> Result<(), String> {
        let (value, expected_process_id) = self
            .0
            .lock()
            .as_ref()
            .copied()
            .ok_or_else(|| "There is no previous window to restore.".to_string())?;
        let hwnd = HWND(value as *mut std::ffi::c_void);
        unsafe {
            if !IsWindow(Some(hwnd)).as_bool() {
                return Err("The previous window is no longer open.".into());
            }
            let mut current_process_id = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut current_process_id));
            if current_process_id != expected_process_id {
                return Err("The previous window is no longer open.".into());
            }
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err("Windows did not allow the previous app to take focus.".into());
            }
        }
        Ok(())
    }
}

fn window_identity(hwnd: HWND) -> Option<(usize, u32)> {
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    (process_id != 0).then_some((hwnd.0 as usize, process_id))
}

pub fn window_hwnd(window: &WebviewWindow) -> Result<HWND, String> {
    window.hwnd().map_err(|error| error.to_string())
}

pub fn foreground_context() -> SourceContext {
    let hwnd = unsafe { GetForegroundWindow() };
    SourceContext {
        hwnd,
        process: process_name(hwnd),
        title: window_title(hwnd),
    }
}

pub fn position_rail(window: &WebviewWindow, anchor: Option<HWND>) -> Result<(), String> {
    let hwnd = window_hwnd(window)?;
    let anchor = anchor.filter(|value| !value.0.is_null()).unwrap_or(hwnd);
    unsafe {
        let monitor = MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("Windows could not determine the active monitor.".into());
        }
        let work_width = info.rcWork.right - info.rcWork.left;
        let work_height = info.rcWork.bottom - info.rcWork.top;
        let current = window.outer_size().map_err(|error| error.to_string())?;
        let width = (current.width as i32)
            .max(MIN_RAIL_WIDTH)
            .min(work_width - RAIL_MARGIN);
        let height = (current.height as i32)
            .max(MIN_RAIL_HEIGHT)
            .min(work_height - RAIL_MARGIN);
        if width != current.width as i32 || height != current.height as i32 {
            window
                .set_size(PhysicalSize::new(width as u32, height as u32))
                .map_err(|error| error.to_string())?;
        }
        let x = info.rcWork.right - width - RAIL_OFFSET;
        let y = info.rcWork.top + RAIL_OFFSET;
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn selected_text() -> Result<(String, SourceContext), String> {
    let context = foreground_context();
    if context.hwnd.0.is_null() {
        return Err("No foreground application is available.".into());
    }
    match selected_text_uia(context.hwnd) {
        Ok(text) if !text.trim().is_empty() => return Ok((text, context)),
        Err(error) if error == UIA_BUSY_ERROR => return Err(error),
        _ => {
            // Fall back to a synthetic copy when UI Automation has no usable selection.
        }
    }
    let text = selected_text_clipboard_fallback(context.hwnd)?;
    if text.trim().is_empty() {
        return Err("No selected text was found. Select text in another app and try again.".into());
    }
    Ok((text, context))
}

fn selected_text_uia(expected_foreground: HWND) -> Result<String, String> {
    if UIA_WORKER_ACTIVE.swap(true, Ordering::AcqRel) {
        return Err(UIA_BUSY_ERROR.into());
    }
    let expected_foreground = expected_foreground.0 as usize;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    if let Err(error) = thread::Builder::new()
        .name("cairn-uia-capture".into())
        .spawn(move || {
            let _guard = UiaWorkerGuard;
            let _ = sender.send(selected_text_uia_sta(HWND(
                expected_foreground as *mut std::ffi::c_void,
            )));
        })
    {
        UIA_WORKER_ACTIVE.store(false, Ordering::Release);
        return Err(error.to_string());
    }
    let result = receiver
        .recv_timeout(UIA_TIMEOUT)
        .map_err(|_| "UI Automation did not respond in time.".to_string())?;
    if unsafe { GetForegroundWindow().0 as usize } != expected_foreground {
        return Err("The foreground application changed during capture.".into());
    }
    result
}

fn selected_text_uia_sta(expected_foreground: HWND) -> Result<String, String> {
    unsafe {
        if GetForegroundWindow() != expected_foreground {
            return Err("The foreground application changed during capture.".into());
        }
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|error| error.to_string())?;
            let element = automation
                .GetFocusedElement()
                .map_err(|error| error.to_string())?;
            let pattern: IUIAutomationTextPattern = element
                .GetCurrentPatternAs(UIA_TextPatternId)
                .map_err(|error| error.to_string())?;
            let ranges = pattern.GetSelection().map_err(|error| error.to_string())?;
            let length = ranges.Length().map_err(|error| error.to_string())?;
            let mut parts = Vec::new();
            for index in 0..length {
                let range = ranges
                    .GetElement(index)
                    .map_err(|error| error.to_string())?;
                let value = range.GetText(-1).map_err(|error| error.to_string())?;
                let text = value.to_string();
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }
            Ok(parts.join("\n"))
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

fn selected_text_clipboard_fallback(foreground: HWND) -> Result<String, String> {
    if CLIPBOARD_CAPTURE_ACTIVE.swap(true, Ordering::AcqRel) {
        return Err("A clipboard capture is already in progress.".into());
    }
    let foreground = foreground.0 as usize;
    let worker = thread::Builder::new()
        .name("cairn-clipboard-capture".into())
        .spawn(move || {
            let _guard = ClipboardCaptureGuard;
            clipboard_fallback_sta(HWND(foreground as *mut std::ffi::c_void))
        });
    let worker = match worker {
        Ok(worker) => worker,
        Err(error) => {
            CLIPBOARD_CAPTURE_ACTIVE.store(false, Ordering::Release);
            return Err(error.to_string());
        }
    };
    worker
        .join()
        .map_err(|_| "The clipboard capture worker stopped unexpectedly.".to_string())?
}

fn clipboard_fallback_sta(expected_foreground: HWND) -> Result<String, String> {
    const CONSOLE_PROCESSES: &[&str] = &[
        "conhost",
        "openconsole",
        "windowsterminal",
        "cmd",
        "powershell",
        "pwsh",
    ];
    let not_found =
        || "No selected text was found. Select text in another app and try again.".to_string();
    if process_name(expected_foreground).is_some_and(|name| {
        CONSOLE_PROCESSES
            .iter()
            .any(|console| name.eq_ignore_ascii_case(console))
    }) {
        return Err(not_found());
    }
    unsafe {
        OleInitialize(None).map_err(|error| error.to_string())?;
        let original = match OleGetClipboard() {
            Ok(data) => data,
            Err(error) => {
                OleUninitialize();
                return Err(format!("The clipboard could not be preserved: {error}"));
            }
        };
        // A text snapshot is a final safety net for clipboard owners that expose a short-lived
        // IDataObject proxy. Rich formats still use the OLE object below.
        let original_text = read_clipboard_text().ok();
        let restore_clipboard = || {
            if OleSetClipboard(&original).is_ok() {
                OleFlushClipboard().map_err(|error| error.to_string())
            } else {
                if let Some(text) = original_text.as_deref() {
                    let _ = write_clipboard_text(text, expected_foreground);
                }
                Err("Windows could not restore the original clipboard contents.".to_string())
            }
        };
        if let Err(error) = wait_for_modifiers_release() {
            drop(original);
            OleUninitialize();
            return Err(error);
        }
        if GetForegroundWindow() != expected_foreground {
            drop(original);
            OleUninitialize();
            return Err(not_found());
        }
        let sequence = GetClipboardSequenceNumber();
        if let Err(error) = send_ctrl_c() {
            let restored = restore_clipboard();
            drop(original);
            OleUninitialize();
            restored?;
            return Err(error);
        }

        let deadline = Instant::now() + Duration::from_millis(900);
        while Instant::now() < deadline && GetClipboardSequenceNumber() == sequence {
            thread::sleep(Duration::from_millis(15));
        }
        let changed = GetClipboardSequenceNumber() != sequence;
        let captured = if changed {
            // Give delayed-rendering clipboard owners a short moment after the sequence changes.
            thread::sleep(Duration::from_millis(20));
            read_clipboard_text()
        } else {
            Err("The selected app did not respond to the clipboard capture fallback.".into())
        };

        let restored = restore_clipboard();
        drop(original);
        OleUninitialize();
        restored?;
        captured
    }
}

fn wait_for_modifiers_release() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_millis(650);
    while Instant::now() < deadline {
        let pressed = unsafe {
            [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
                .iter()
                .any(|key| GetAsyncKeyState(key.0 as i32) < 0)
        };
        if !pressed {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err("Release Ctrl, Alt, Shift, or Win before capturing selected text.".into())
}

pub fn write_clipboard_text(text: &str, owner: HWND) -> Result<(), String> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    unsafe {
        OleInitialize(None).map_err(|error| error.to_string())?;
        let original = match OleGetClipboard() {
            Ok(data) => data,
            Err(error) => {
                OleUninitialize();
                return Err(format!("The clipboard could not be preserved: {error}"));
            }
        };
        let bytes = wide.len() * size_of::<u16>();
        let memory = match GlobalAlloc(GMEM_MOVEABLE, bytes) {
            Ok(memory) => memory,
            Err(error) => {
                drop(original);
                OleUninitialize();
                return Err(error.to_string());
            }
        };
        let target = GlobalLock(memory) as *mut u16;
        if target.is_null() {
            let _ = GlobalFree(Some(memory));
            drop(original);
            OleUninitialize();
            return Err("Windows could not allocate clipboard memory.".into());
        }
        ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
        let _ = GlobalUnlock(memory);
        if let Err(error) = open_clipboard_retry(Some(owner)) {
            let _ = GlobalFree(Some(memory));
            drop(original);
            OleUninitialize();
            return Err(error);
        }
        if let Err(error) = EmptyClipboard() {
            let _ = GlobalFree(Some(memory));
            let _ = CloseClipboard();
            drop(original);
            OleUninitialize();
            return Err(error.to_string());
        }
        let handle = HANDLE(memory.0);
        let published = SetClipboardData(CF_UNICODETEXT.0 as u32, Some(handle));
        let _ = CloseClipboard();
        if let Err(error) = published {
            let _ = GlobalFree(Some(memory));
            let restored = if OleSetClipboard(&original).is_ok() {
                OleFlushClipboard().map_err(|restore_error| restore_error.to_string())
            } else {
                Err("Windows could not restore the original clipboard contents.".to_string())
            };
            drop(original);
            OleUninitialize();
            restored?;
            return Err(error.to_string());
        }
        drop(original);
        OleUninitialize();
        Ok(())
    }
}

fn read_clipboard_text() -> Result<String, String> {
    unsafe {
        open_clipboard_retry(None)?;
        let result = (|| {
            let handle =
                GetClipboardData(CF_UNICODETEXT.0 as u32).map_err(|error| error.to_string())?;
            let memory = HGLOBAL(handle.0);
            let pointer = GlobalLock(memory) as *const u16;
            if pointer.is_null() {
                return Err("The copied text was not readable.".into());
            }
            let units = std::slice::from_raw_parts(pointer, GlobalSize(memory) / size_of::<u16>());
            let Some(length) = units.iter().position(|unit| *unit == 0) else {
                let _ = GlobalUnlock(memory);
                return Err("The copied text was not terminated correctly.".into());
            };
            let text = String::from_utf16_lossy(&units[..length]);
            let _ = GlobalUnlock(memory);
            Ok(text)
        })();
        let _ = CloseClipboard();
        result
    }
}

fn open_clipboard_retry(owner: Option<HWND>) -> Result<(), String> {
    let mut last_error = None;
    for _ in 0..8 {
        match unsafe { OpenClipboard(owner) } {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error.to_string());
                thread::sleep(Duration::from_millis(12));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "The Windows clipboard is unavailable.".into()))
}

fn send_ctrl_c() -> Result<(), String> {
    let keyboard = |key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let inputs = [
        keyboard(VK_CONTROL, Default::default()),
        keyboard(VK_C, Default::default()),
        keyboard(VK_C, KEYEVENTF_KEYUP),
        keyboard(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        let cleanup = [
            keyboard(VK_C, KEYEVENTF_KEYUP),
            keyboard(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        unsafe {
            let _ = SendInput(&cleanup, size_of::<INPUT>() as i32);
        }
        return Err("Windows could not send the clipboard fallback shortcut.".into());
    }
    Ok(())
}

fn window_title(hwnd: HWND) -> Option<String> {
    unsafe {
        let length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        (copied > 0).then(|| String::from_utf16_lossy(&buffer[..copied as usize]))
    }
}

fn process_name(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
        .is_ok();
        let _ = CloseHandle(process);
        if !queried {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        Path::new(&path)
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
    }
}

pub fn is_window_visible(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or_else(|_| {
        window_hwnd(window).is_ok_and(|hwnd| unsafe { IsWindowVisible(hwnd).as_bool() })
    })
}

pub fn main_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "The Cairn window is unavailable.".into())
}
