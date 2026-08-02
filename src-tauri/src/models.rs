use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub opacity: u8,
    pub accent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub appearance: AppearanceSettings,
    pub always_on_top: bool,
    pub global_shortcuts: BTreeMap<String, Option<String>>,
    pub app_shortcuts: BTreeMap<String, Option<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings {
                theme: "system".into(),
                opacity: 94,
                accent: "blue".into(),
            },
            always_on_top: true,
            global_shortcuts: BTreeMap::from([
                ("showHide".into(), Some("Ctrl+Alt+Space".into())),
                ("captureSelection".into(), Some("Ctrl+Alt+G".into())),
                ("openNewCard".into(), Some("Ctrl+Alt+N".into())),
                ("copyReturn".into(), Some("Ctrl+Alt+Enter".into())),
                (
                    "copyCompleteReturn".into(),
                    Some("Ctrl+Alt+Shift+Enter".into()),
                ),
                ("toggleAlwaysOnTop".into(), Some("Ctrl+Alt+P".into())),
                ("clearAll".into(), None),
            ]),
            app_shortcuts: BTreeMap::from([
                ("mergeSelected".into(), Some("Ctrl+Shift+M".into())),
                ("editFocused".into(), Some("F2".into())),
                ("moveToSection".into(), Some("Ctrl+Shift+V".into())),
            ]),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub section_id: Option<String>,
    pub sort_order: i64,
    pub source_process: Option<String>,
    pub source_window_title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub cards: Vec<Card>,
    pub sections: Vec<Section>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentBackup {
    pub cards: Vec<Card>,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutEvent {
    pub action: String,
}
