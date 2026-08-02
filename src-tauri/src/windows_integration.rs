use std::{
    mem::size_of,
    path::Path,
    ptr, thread,
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
                KEYEVENTF_KEYUP, VK_C, VK_CONTROL, VK_MENU, VK_SHIFT,
            },
            WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
                GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
                SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE,
            },
        },
    },
};

#[derive(Debug, Clone)]
pub struct SourceContext {
    pub hwnd: HWND,
    pub process: Option<String>,
    pub title: Option<String>,
}

// HWND values are opaque process-local handles. The wrapper makes the stored value explicit and
// keeps raw Win32 handles out of the cross-thread application state.
#[derive(Default)]
pub struct PreviousWindow(parking_lot::Mutex<Option<usize>>);

impl PreviousWindow {
    pub fn remember(&self, cairn_hwnd: Option<HWND>) -> Option<HWND> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0.is_null() || cairn_hwnd.is_some_and(|window| window == foreground) {
            return self.get();
        }
        *self.0.lock() = Some(foreground.0 as usize);
        Some(foreground)
    }

    pub fn set(&self, hwnd: HWND) {
        if !hwnd.0.is_null() {
            *self.0.lock() = Some(hwnd.0 as usize);
        }
    }

    pub fn get(&self) -> Option<HWND> {
        self.0
            .lock()
            .map(|value| HWND(value as *mut std::ffi::c_void))
    }

    pub fn restore(&self) -> Result<(), String> {
        let hwnd = self
            .get()
            .ok_or_else(|| "There is no previous window to restore.".to_string())?;
        unsafe {
            if !IsWindow(Some(hwnd)).as_bool() {
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
        let width = (current.width as i32).min(work_width - 24).max(340);
        let height = (current.height as i32).min(work_height - 24).max(480);
        if width != current.width as i32 || height != current.height as i32 {
            window
                .set_size(PhysicalSize::new(width as u32, height as u32))
                .map_err(|error| error.to_string())?;
        }
        let x = info.rcWork.right - width - 12;
        let y = info.rcWork.top + 12;
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
    if let Ok(text) = selected_text_uia() {
        if !text.trim().is_empty() {
            return Ok((text, context));
        }
    }
    let text = selected_text_clipboard_fallback()?;
    if text.trim().is_empty() {
        return Err("No selected text was found. Select text in another app and try again.".into());
    }
    Ok((text, context))
}

fn selected_text_uia() -> Result<String, String> {
    unsafe {
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

fn selected_text_clipboard_fallback() -> Result<String, String> {
    thread::Builder::new()
        .name("cairn-clipboard-capture".into())
        .spawn(clipboard_fallback_sta)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|_| "The clipboard capture worker stopped unexpectedly.".to_string())?
}

fn clipboard_fallback_sta() -> Result<String, String> {
    unsafe {
        OleInitialize(None).map_err(|error| error.to_string())?;
        let original = OleGetClipboard().ok();
        // A text snapshot is a final safety net for clipboard owners that expose a short-lived
        // IDataObject proxy. Rich formats still use the OLE object below.
        let original_text = read_clipboard_text().ok();
        if let Err(error) = wait_for_modifiers_release() {
            OleUninitialize();
            return Err(error);
        }
        let sequence = GetClipboardSequenceNumber();
        if let Err(error) = send_ctrl_c() {
            OleUninitialize();
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

        match original {
            Some(data) => {
                if OleSetClipboard(&data).is_ok() {
                    let _ = OleFlushClipboard();
                } else if let Some(text) = original_text.as_deref() {
                    let _ = write_clipboard_text(text);
                }
            }
            None => {
                if let Some(text) = original_text.as_deref() {
                    let _ = write_clipboard_text(text);
                } else if open_clipboard_retry().is_ok() {
                    let _ = EmptyClipboard();
                    let _ = CloseClipboard();
                }
            }
        }
        OleUninitialize();
        captured
    }
}

fn wait_for_modifiers_release() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_millis(650);
    while Instant::now() < deadline {
        let pressed = unsafe {
            [VK_CONTROL, VK_MENU, VK_SHIFT]
                .iter()
                .any(|key| GetAsyncKeyState(key.0 as i32) < 0)
        };
        if !pressed {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err("Release Ctrl, Alt, or Shift before capturing selected text.".into())
}

pub fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    unsafe {
        open_clipboard_retry()?;
        let result = (|| {
            EmptyClipboard().map_err(|error| error.to_string())?;
            let bytes = wide.len() * size_of::<u16>();
            let memory = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|error| error.to_string())?;
            let target = GlobalLock(memory) as *mut u16;
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err("Windows could not allocate clipboard memory.".into());
            }
            ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
            let _ = GlobalUnlock(memory);
            let handle = HANDLE(memory.0);
            if let Err(error) = SetClipboardData(CF_UNICODETEXT.0 as u32, Some(handle)) {
                let _ = GlobalFree(Some(memory));
                return Err(error.to_string());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

fn read_clipboard_text() -> Result<String, String> {
    unsafe {
        open_clipboard_retry()?;
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

fn open_clipboard_retry() -> Result<(), String> {
    let mut last_error = None;
    for _ in 0..8 {
        match unsafe { OpenClipboard(None) } {
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
