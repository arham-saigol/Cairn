use crate::models::{AppSettings, Card, ContentBackup, Section, Snapshot};
use chrono::{SecondsFormat, Utc};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::path::Path;
use uuid::Uuid;

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if path != Path::new(":memory:") {
            let parent = path
                .parent()
                .ok_or_else(|| "The database path has no parent directory.".to_string())?;
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA foreign_keys=ON;
                 PRAGMA busy_timeout=5000;
                 CREATE TABLE IF NOT EXISTS sections (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                   sort_order INTEGER NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS cards (
                   id TEXT PRIMARY KEY,
                   content TEXT NOT NULL,
                   completed INTEGER NOT NULL DEFAULT 0,
                   section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
                   sort_order INTEGER NOT NULL,
                   source_process TEXT,
                   source_window_title TEXT,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_cards_sort ON cards(sort_order);
                 CREATE INDEX IF NOT EXISTS idx_cards_section ON cards(section_id, sort_order);
                 CREATE TABLE IF NOT EXISTS settings (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS backups (
                   id TEXT PRIMARY KEY,
                   payload TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn bootstrap(&self) -> Result<Snapshot, String> {
        let connection = self.connection.lock();
        let cards = list_cards(&connection)?;
        let sections = list_sections(&connection)?;
        let settings_json: Option<String> = connection
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        let settings = settings_json
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        Ok(Snapshot {
            cards,
            sections,
            settings,
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
        self.connection
            .lock()
            .execute(
                "INSERT INTO settings(key, value) VALUES('app', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [value],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn create_note(
        &self,
        content: &str,
        section_id: Option<String>,
        source_process: Option<String>,
        source_window_title: Option<String>,
    ) -> Result<Card, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("A card cannot be empty.".into());
        }
        let connection = self.connection.lock();
        let sort_order: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cards",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let stamp = timestamp();
        let card = Card {
            id: Uuid::new_v4().to_string(),
            content: content.into(),
            completed: false,
            section_id,
            sort_order,
            source_process,
            source_window_title,
            created_at: stamp.clone(),
            updated_at: stamp,
        };
        insert_card(&connection, &card)?;
        Ok(card)
    }

    pub fn create_section(&self, name: &str) -> Result<Section, String> {
        let name = name.trim().trim_start_matches('#').trim();
        if name.is_empty() {
            return Err("A section needs a name.".into());
        }
        let connection = self.connection.lock();
        let sort_order: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sections",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let section = Section {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            sort_order,
            created_at: timestamp(),
        };
        connection
            .execute(
                "INSERT INTO sections(id, name, sort_order, created_at) VALUES(?1, ?2, ?3, ?4)",
                params![
                    section.id,
                    section.name,
                    section.sort_order,
                    section.created_at
                ],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE") {
                    "A section with that name already exists.".into()
                } else {
                    error.to_string()
                }
            })?;
        Ok(section)
    }

    pub fn update_card_content(&self, id: &str, content: &str) -> Result<Card, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("A card cannot be empty.".into());
        }
        let connection = self.connection.lock();
        let updated_at = timestamp();
        let changed = connection
            .execute(
                "UPDATE cards SET content = ?1, updated_at = ?2 WHERE id = ?3",
                params![content, updated_at, id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("That card no longer exists.".into());
        }
        get_card(&connection, id)
    }

    pub fn set_cards_completed(
        &self,
        ids: &[String],
        completed: bool,
    ) -> Result<Vec<String>, String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let mut changed = Vec::new();
        for id in ids {
            let count = transaction
                .execute(
                    "UPDATE cards SET completed = ?1, updated_at = ?2 WHERE id = ?3 AND completed != ?1",
                    params![completed as i64, timestamp(), id],
                )
                .map_err(|error| error.to_string())?;
            if count > 0 {
                changed.push(id.clone());
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(changed)
    }

    pub fn delete_cards(&self, ids: &[String]) -> Result<(), String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for id in ids {
            transaction
                .execute("DELETE FROM cards WHERE id = ?1", [id])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn move_cards(&self, ids: &[String], section_id: Option<String>) -> Result<(), String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for id in ids {
            transaction
                .execute(
                    "UPDATE cards SET section_id = ?1, updated_at = ?2 WHERE id = ?3",
                    params![section_id, timestamp(), id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn reorder_cards(&self, ids: &[String]) -> Result<(), String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for (index, id) in ids.iter().enumerate() {
            transaction
                .execute(
                    "UPDATE cards SET sort_order = ?1 WHERE id = ?2",
                    params![index as i64, id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn merge_cards(&self, ids: &[String]) -> Result<Card, String> {
        if ids.len() < 2 {
            return Err("Select two or more cards to merge.".into());
        }
        let mut connection = self.connection.lock();
        let mut selected: Vec<Card> = list_cards(&connection)?
            .into_iter()
            .filter(|card| ids.contains(&card.id))
            .collect();
        selected.sort_by_key(|card| card.sort_order);
        if selected.len() < 2 {
            return Err("Some selected cards no longer exist.".into());
        }
        let mut merged = selected[0].clone();
        merged.content = selected
            .iter()
            .map(|card| card.content.trim())
            .collect::<Vec<_>>()
            .join("\n\n");
        merged.completed = selected.iter().all(|card| card.completed);
        merged.updated_at = timestamp();

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE cards SET content = ?1, completed = ?2, updated_at = ?3 WHERE id = ?4",
                params![
                    merged.content,
                    merged.completed as i64,
                    merged.updated_at,
                    merged.id
                ],
            )
            .map_err(|error| error.to_string())?;
        for card in selected.iter().skip(1) {
            transaction
                .execute("DELETE FROM cards WHERE id = ?1", [&card.id])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(merged)
    }

    pub fn clear_all(&self) -> Result<String, String> {
        let mut connection = self.connection.lock();
        let backup = ContentBackup {
            cards: list_cards(&connection)?,
            sections: list_sections(&connection)?,
        };
        let id = Uuid::new_v4().to_string();
        let payload = serde_json::to_string(&backup).map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO backups(id, payload, created_at) VALUES(?1, ?2, ?3)",
                params![id, payload, timestamp()],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM cards", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM sections", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT 10)",
                [],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(id)
    }

    pub fn restore_backup(&self, id: &str) -> Result<Snapshot, String> {
        let mut connection = self.connection.lock();
        let payload: String = connection
            .query_row("SELECT payload FROM backups WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "That local backup is no longer available.".to_string())?;
        let backup: ContentBackup =
            serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM cards", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM sections", [])
            .map_err(|error| error.to_string())?;
        restore_content(&transaction, &backup)?;
        transaction.commit().map_err(|error| error.to_string())?;
        drop(connection);
        self.bootstrap()
    }
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn insert_card(connection: &Connection, card: &Card) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO cards(id, content, completed, section_id, sort_order, source_process, source_window_title, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                card.id,
                card.content,
                card.completed as i64,
                card.section_id,
                card.sort_order,
                card.source_process,
                card.source_window_title,
                card.created_at,
                card.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn restore_content(transaction: &Transaction<'_>, backup: &ContentBackup) -> Result<(), String> {
    for section in &backup.sections {
        transaction
            .execute(
                "INSERT INTO sections(id, name, sort_order, created_at) VALUES(?1, ?2, ?3, ?4)",
                params![
                    section.id,
                    section.name,
                    section.sort_order,
                    section.created_at
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for card in &backup.cards {
        insert_card(transaction, card)?;
    }
    Ok(())
}

fn list_cards(connection: &Connection) -> Result<Vec<Card>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, content, completed, section_id, sort_order, source_process, source_window_title, created_at, updated_at
             FROM cards ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Card {
                id: row.get(0)?,
                content: row.get(1)?,
                completed: row.get::<_, i64>(2)? != 0,
                section_id: row.get(3)?,
                sort_order: row.get(4)?,
                source_process: row.get(5)?,
                source_window_title: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn list_sections(connection: &Connection) -> Result<Vec<Section>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, sort_order, created_at FROM sections ORDER BY sort_order ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Section {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn get_card(connection: &Connection, id: &str) -> Result<Card, String> {
    connection
        .query_row(
            "SELECT id, content, completed, section_id, sort_order, source_process, source_window_title, created_at, updated_at FROM cards WHERE id = ?1",
            [id],
            |row| {
                Ok(Card {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    completed: row.get::<_, i64>(2)? != 0,
                    section_id: row.get(3)?,
                    sort_order: row.get(4)?,
                    source_process: row.get(5)?,
                    source_window_title: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Database {
        Database::open(Path::new(":memory:")).unwrap()
    }

    #[test]
    fn stores_sections_cards_and_order() {
        let db = database();
        let section = db.create_section("Research").unwrap();
        let first = db
            .create_note("First", Some(section.id.clone()), None, None)
            .unwrap();
        let second = db.create_note("Second", None, None, None).unwrap();
        db.reorder_cards(&[second.id.clone(), first.id.clone()])
            .unwrap();
        let snapshot = db.bootstrap().unwrap();
        assert_eq!(snapshot.cards[0].content, "Second");
        assert_eq!(snapshot.sections[0].name, "Research");
    }

    #[test]
    fn merge_preserves_display_order() {
        let db = database();
        let first = db.create_note("Alpha", None, None, None).unwrap();
        let second = db.create_note("Beta", None, None, None).unwrap();
        let merged = db.merge_cards(&[second.id, first.id]).unwrap();
        assert_eq!(merged.content, "Alpha\n\nBeta");
        assert_eq!(db.bootstrap().unwrap().cards.len(), 1);
    }

    #[test]
    fn clear_creates_a_restorable_backup() {
        let db = database();
        db.create_note("Keep me", None, None, None).unwrap();
        let backup = db.clear_all().unwrap();
        assert!(db.bootstrap().unwrap().cards.is_empty());
        let restored = db.restore_backup(&backup).unwrap();
        assert_eq!(restored.cards[0].content, "Keep me");
    }
}
