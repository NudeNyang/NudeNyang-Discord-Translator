use std::collections::{HashMap, VecDeque};
use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

type CacheKey = (String, String, String);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OutgoingOriginalRecord {
    pub message_id: String,
    pub channel_key: String,
    pub original_text: String,
    pub sent_text: String,
    pub part_number: usize,
    pub total_parts: usize,
    pub created_at: f64,
}

#[derive(Clone, Debug)]
struct CacheEntry {
    source_hash: String,
    source_text: String,
    source_language: String,
    target_language: String,
    translator: String,
    translated_text: String,
    updated_at: f64,
}

impl CacheEntry {
    fn key(&self) -> CacheKey {
        (
            self.source_hash.clone(),
            self.target_language.clone(),
            self.translator.clone(),
        )
    }
}

#[derive(Default)]
struct MemoryCache {
    entries: HashMap<CacheKey, CacheEntry>,
    order: VecDeque<CacheKey>,
}

impl MemoryCache {
    fn get(&mut self, key: &CacheKey) -> Option<CacheEntry> {
        let entry = self.entries.get(key)?.clone();
        self.promote(key);
        Some(entry)
    }

    fn put(&mut self, entry: CacheEntry, capacity: usize) {
        if capacity == 0 {
            return;
        }
        let key = entry.key();
        self.entries.insert(key.clone(), entry);
        self.promote(&key);
        while self.entries.len() > capacity {
            if let Some(expired) = self.order.pop_front() {
                self.entries.remove(&expired);
            }
        }
    }

    fn promote(&mut self, key: &CacheKey) {
        if let Some(position) = self.order.iter().position(|candidate| candidate == key) {
            self.order.remove(position);
        }
        self.order.push_back(key.clone());
    }

    fn fuzzy_match(
        &mut self,
        normalized: &str,
        source_language: &str,
        target_language: &str,
        translator: &str,
    ) -> Option<CacheEntry> {
        let matched_key = self.order.iter().rev().find(|key| {
            self.entries.get(*key).is_some_and(|entry| {
                entry.source_language == source_language
                    && entry.target_language == target_language
                    && entry.translator == translator
                    && text_matches(&normalize_text(&entry.source_text), normalized)
            })
        })?;
        let key = matched_key.clone();
        let entry = self.entries.get(&key)?.clone();
        self.promote(&key);
        Some(entry)
    }
}

pub struct TranslationCache {
    connection: Mutex<Connection>,
    memory: Mutex<MemoryCache>,
    memory_capacity: usize,
}

impl TranslationCache {
    pub fn open_default() -> Result<Self, String> {
        Self::open(default_cache_path(), 4096)
    }

    pub fn open(path: PathBuf, memory_capacity: usize) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "번역 캐시 폴더를 만들지 못했습니다 ({}): {error}",
                    parent.display()
                )
            })?;
        }
        let mut connection = Connection::open(&path).map_err(|error| {
            format!("번역 캐시를 열지 못했습니다 ({}): {error}", path.display())
        })?;
        initialize_schema(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            memory: Mutex::new(MemoryCache::default()),
            memory_capacity,
        })
    }

    pub fn get(
        &self,
        source_hash: &str,
        target_language: &str,
        translator: &str,
    ) -> Result<Option<String>, String> {
        let key = (
            source_hash.to_string(),
            target_language.to_string(),
            translator.to_string(),
        );
        if let Some(entry) = self
            .memory
            .lock()
            .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())?
            .get(&key)
        {
            return Ok(Some(entry.translated_text));
        }

        let entry = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| "SQLite 번역 캐시 잠금을 열지 못했습니다.".to_string())?;
            connection
                .query_row(
                    "SELECT source_text, source_language, translated_text, updated_at \
                     FROM translations \
                     WHERE source_hash=?1 AND target_language=?2 AND translator=?3",
                    params![source_hash, target_language, translator],
                    |row| {
                        Ok(CacheEntry {
                            source_hash: source_hash.to_string(),
                            source_text: row.get(0)?,
                            source_language: row.get(1)?,
                            target_language: target_language.to_string(),
                            translator: translator.to_string(),
                            translated_text: row.get(2)?,
                            updated_at: row.get(3)?,
                        })
                    },
                )
                .optional()
                .map_err(|error| format!("번역 캐시를 조회하지 못했습니다: {error}"))?
        };
        let Some(entry) = entry else {
            return Ok(None);
        };
        let translated = entry.translated_text.clone();
        self.remember(entry)?;
        Ok(Some(translated))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_message(
        &self,
        source_hash: &str,
        source_text: &str,
        source_language: &str,
        target_language: &str,
        translator: &str,
        allow_fuzzy: bool,
    ) -> Result<Option<String>, String> {
        if let Some(exact) = self.get(source_hash, target_language, translator)? {
            return Ok(Some(exact));
        }
        if !allow_fuzzy {
            return Ok(None);
        }
        let normalized = normalize_text(source_text);
        let memory_match = {
            let mut memory = self
                .memory
                .lock()
                .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())?;
            memory.fuzzy_match(&normalized, source_language, target_language, translator)
        };
        if let Some(entry) = memory_match {
            let translated = entry.translated_text;
            self.put(
                source_hash,
                source_text,
                source_language,
                target_language,
                &translated,
                translator,
            )?;
            return Ok(Some(translated));
        }

        let matched = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| "SQLite 번역 캐시 잠금을 열지 못했습니다.".to_string())?;
            let mut statement = connection
                .prepare(
                    "SELECT source_hash, source_text, translated_text, updated_at \
                     FROM translations \
                     WHERE source_language=?1 AND target_language=?2 AND translator=?3 \
                     ORDER BY updated_at DESC",
                )
                .map_err(|error| format!("번역 캐시 조회를 준비하지 못했습니다: {error}"))?;
            let rows = statement
                .query_map(
                    params![source_language, target_language, translator],
                    |row| {
                        Ok(CacheEntry {
                            source_hash: row.get(0)?,
                            source_text: row.get(1)?,
                            source_language: source_language.to_string(),
                            target_language: target_language.to_string(),
                            translator: translator.to_string(),
                            translated_text: row.get(2)?,
                            updated_at: row.get(3)?,
                        })
                    },
                )
                .map_err(|error| format!("번역 캐시를 조회하지 못했습니다: {error}"))?;
            let mut matched = None;
            for row in rows {
                let entry =
                    row.map_err(|error| format!("번역 캐시 행을 읽지 못했습니다: {error}"))?;
                if text_matches(&normalize_text(&entry.source_text), &normalized) {
                    matched = Some(entry);
                    break;
                }
            }
            matched
        };
        let Some(entry) = matched else {
            return Ok(None);
        };
        self.remember(entry.clone())?;
        let translated = entry.translated_text;
        self.put(
            source_hash,
            source_text,
            source_language,
            target_language,
            &translated,
            translator,
        )?;
        Ok(Some(translated))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn put(
        &self,
        source_hash: &str,
        source_text: &str,
        source_language: &str,
        target_language: &str,
        translated_text: &str,
        translator: &str,
    ) -> Result<(), String> {
        let entry = CacheEntry {
            source_hash: source_hash.to_string(),
            source_text: source_text.to_string(),
            source_language: source_language.to_string(),
            target_language: target_language.to_string(),
            translator: translator.to_string(),
            translated_text: translated_text.to_string(),
            updated_at: now_seconds(),
        };
        self.remember(entry.clone())?;
        self.connection
            .lock()
            .map_err(|_| "SQLite 번역 캐시 잠금을 열지 못했습니다.".to_string())?
            .execute(
                "INSERT INTO translations \
                 (source_hash, source_text, source_language, target_language, translator, translated_text, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(source_hash, target_language, translator) DO UPDATE SET \
                   source_text=excluded.source_text, \
                   source_language=excluded.source_language, \
                   translated_text=excluded.translated_text, \
                   updated_at=excluded.updated_at",
                params![
                    entry.source_hash,
                    entry.source_text,
                    entry.source_language,
                    entry.target_language,
                    entry.translator,
                    entry.translated_text,
                    entry.updated_at,
                ],
            )
            .map_err(|error| format!("번역 캐시를 저장하지 못했습니다: {error}"))?;
        Ok(())
    }

    pub fn memory_size(&self) -> Result<usize, String> {
        self.memory
            .lock()
            .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())
            .map(|memory| memory.entries.len())
    }

    pub fn memory_contains(
        &self,
        source_hash: &str,
        target_language: &str,
        translator: &str,
    ) -> Result<bool, String> {
        let key = (
            source_hash.to_string(),
            target_language.to_string(),
            translator.to_string(),
        );
        self.memory
            .lock()
            .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())
            .map(|memory| memory.entries.contains_key(&key))
    }

    pub fn put_outgoing_original(&self, record: &OutgoingOriginalRecord) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "보낸 메시지 원문 저장소 잠금을 열지 못했습니다.".to_string())?;
        connection
            .execute(
                "INSERT INTO outgoing_originals \
                 (message_id, channel_key, original_text, sent_text, part_number, total_parts, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(channel_key, message_id) DO UPDATE SET \
                   original_text=excluded.original_text, \
                   sent_text=excluded.sent_text, \
                   part_number=excluded.part_number, \
                   total_parts=excluded.total_parts, \
                   created_at=excluded.created_at",
                params![
                    record.message_id,
                    record.channel_key,
                    record.original_text,
                    record.sent_text,
                    record.part_number,
                    record.total_parts,
                    record.created_at,
                ],
            )
            .map_err(|error| format!("보낸 메시지 원문을 저장하지 못했습니다: {error}"))?;
        connection
            .execute(
                "DELETE FROM outgoing_originals WHERE created_at < ?1",
                params![now_seconds() - 30.0 * 24.0 * 60.0 * 60.0],
            )
            .map_err(|error| format!("오래된 보낸 메시지 원문을 정리하지 못했습니다: {error}"))?;
        connection
            .execute(
                "DELETE FROM outgoing_originals WHERE rowid NOT IN (\
                   SELECT rowid FROM outgoing_originals ORDER BY created_at DESC LIMIT 2000\
                 )",
                [],
            )
            .map_err(|error| {
                format!("보낸 메시지 원문 저장 한도를 적용하지 못했습니다: {error}")
            })?;
        Ok(())
    }

    pub fn outgoing_originals_for_channel(
        &self,
        channel_key: &str,
        limit: usize,
    ) -> Result<Vec<OutgoingOriginalRecord>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "보낸 메시지 원문 저장소 잠금을 열지 못했습니다.".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT message_id, channel_key, original_text, sent_text, \
                        part_number, total_parts, created_at \
                 FROM outgoing_originals \
                 WHERE channel_key=?1 \
                 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(|error| format!("보낸 메시지 원문 조회를 준비하지 못했습니다: {error}"))?;
        let rows = statement
            .query_map(params![channel_key, limit], |row| {
                Ok(OutgoingOriginalRecord {
                    message_id: row.get(0)?,
                    channel_key: row.get(1)?,
                    original_text: row.get(2)?,
                    sent_text: row.get(3)?,
                    part_number: row.get(4)?,
                    total_parts: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|error| format!("보낸 메시지 원문을 조회하지 못했습니다: {error}"))?;
        rows.map(|row| {
            row.map_err(|error| format!("보낸 메시지 원문 행을 읽지 못했습니다: {error}"))
        })
        .collect()
    }

    fn remember(&self, entry: CacheEntry) -> Result<(), String> {
        self.memory
            .lock()
            .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())?
            .put(entry, self.memory_capacity);
        Ok(())
    }
}

fn initialize_schema(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS translations (\
               source_hash TEXT NOT NULL,\
               source_text TEXT NOT NULL,\
               source_language TEXT NOT NULL,\
               target_language TEXT NOT NULL,\
               translator TEXT NOT NULL DEFAULT 'deepl:v1',\
               translated_text TEXT NOT NULL,\
               updated_at REAL NOT NULL,\
               PRIMARY KEY (source_hash, target_language, translator)\
             );\
             CREATE TABLE IF NOT EXISTS outgoing_originals (\
               message_id TEXT NOT NULL,\
               channel_key TEXT NOT NULL,\
               original_text TEXT NOT NULL,\
               sent_text TEXT NOT NULL,\
               part_number INTEGER NOT NULL DEFAULT 1,\
               total_parts INTEGER NOT NULL DEFAULT 1,\
               created_at REAL NOT NULL,\
               PRIMARY KEY (channel_key, message_id)\
             );",
        )
        .map_err(|error| format!("번역 캐시 테이블을 만들지 못했습니다: {error}"))?;
    let has_translator = {
        let mut statement = connection
            .prepare("PRAGMA table_info(translations)")
            .map_err(|error| format!("번역 캐시 스키마를 확인하지 못했습니다: {error}"))?;
        let found = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("번역 캐시 스키마를 읽지 못했습니다: {error}"))?
            .filter_map(Result::ok)
            .any(|column| column == "translator");
        found
    };
    if has_translator {
        return Ok(());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| format!("번역 캐시 마이그레이션을 시작하지 못했습니다: {error}"))?;
    transaction
        .execute_batch(
            "ALTER TABLE translations RENAME TO translations_legacy;\
             CREATE TABLE translations (\
               source_hash TEXT NOT NULL,\
               source_text TEXT NOT NULL,\
               source_language TEXT NOT NULL,\
               target_language TEXT NOT NULL,\
               translator TEXT NOT NULL,\
               translated_text TEXT NOT NULL,\
               updated_at REAL NOT NULL,\
               PRIMARY KEY (source_hash, target_language, translator)\
             );\
             INSERT INTO translations\
               (source_hash, source_text, source_language, target_language, translator, translated_text, updated_at)\
             SELECT source_hash, source_text, source_language, target_language, 'deepl:v1', translated_text, updated_at\
             FROM translations_legacy;\
             DROP TABLE translations_legacy;",
        )
        .map_err(|error| format!("이전 번역 캐시를 변환하지 못했습니다: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("번역 캐시 마이그레이션을 완료하지 못했습니다: {error}"))
}

fn default_cache_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        return PathBuf::from(local_app_data)
            .join("LocalTools")
            .join("DiscordTranslateOverlay")
            .join("Cache")
            .join("cache.db");
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("DiscordTranslateOverlay")
            .join("cache.db");
    }

    env::var_os("XDG_CACHE_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DiscordTranslateOverlay")
        .join("cache.db")
}

fn normalize_text(text: &str) -> String {
    text.nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn text_matches(left: &str, right: &str) -> bool {
    left == right
        || (left.chars().count().min(right.chars().count()) >= 8
            && edit_distance_at_most_one(left, right))
}

fn edit_distance_at_most_one(first: &str, second: &str) -> bool {
    let first: Vec<char> = first.chars().collect();
    let second: Vec<char> = second.chars().collect();
    if first.len().abs_diff(second.len()) > 1 {
        return false;
    }
    if first.len() == second.len() {
        return first
            .iter()
            .zip(second.iter())
            .filter(|(left, right)| left != right)
            .count()
            <= 1;
    }
    let (shorter, longer) = if first.len() < second.len() {
        (&first, &second)
    } else {
        (&second, &first)
    };
    let (mut short_index, mut long_index, mut skipped) = (0, 0, false);
    while short_index < shorter.len() && long_index < longer.len() {
        if shorter[short_index] == longer[long_index] {
            short_index += 1;
            long_index += 1;
        } else if skipped {
            return false;
        } else {
            skipped = true;
            long_index += 1;
        }
    }
    true
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

trait OptionalRow<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OutgoingOriginalRecord, TranslationCache};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_cache_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nude-translator-cache-{name}-{nonce}"))
            .join("cache.db")
    }

    #[test]
    fn translations_round_trip_and_are_separated_by_engine() {
        let path = temporary_cache_path("round-trip");
        {
            let cache = TranslationCache::open(path.clone(), 4096).unwrap();
            assert_eq!(cache.get("same", "ko", "deepl:v1").unwrap(), None);
            cache
                .put("same", "hello", "en", "ko", "DeepL 결과", "deepl:v1")
                .unwrap();
            cache
                .put("same", "hello", "en", "ko", "로컬 결과", "local:test")
                .unwrap();
            assert_eq!(
                cache.get("same", "ko", "deepl:v1").unwrap().as_deref(),
                Some("DeepL 결과")
            );
            assert_eq!(
                cache.get("same", "ko", "local:test").unwrap().as_deref(),
                Some("로컬 결과")
            );
        }
        let reopened = TranslationCache::open(path.clone(), 4096).unwrap();
        assert_eq!(
            reopened.get("same", "ko", "local:test").unwrap().as_deref(),
            Some("로컬 결과")
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn message_lookup_reuses_normalized_and_one_character_variants() {
        let path = temporary_cache_path("fuzzy");
        let cache = TranslationCache::open(path.clone(), 4096).unwrap();
        cache
            .put(
                "first",
                "3歳だから仕方ないね",
                "ja",
                "ko",
                "3살이니까 어쩔 수 없네",
                "hy:test",
            )
            .unwrap();
        assert_eq!(
            cache
                .get_message(
                    "second",
                    "  3歳だから仕方ないれ  ",
                    "ja",
                    "ko",
                    "hy:test",
                    true,
                )
                .unwrap()
                .as_deref(),
            Some("3살이니까 어쩔 수 없네")
        );
        assert_eq!(
            cache
                .get_message("face", "(•ω•)つス.....", "ja", "ko", "hy:test", false)
                .unwrap(),
            None
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn memory_lru_is_bounded_and_promotes_hits() {
        let path = temporary_cache_path("lru");
        let cache = TranslationCache::open(path.clone(), 2).unwrap();
        for (key, translated) in [("a", "A"), ("b", "B")] {
            cache
                .put(key, key, "en", "ko", translated, "test:v1")
                .unwrap();
        }
        cache.get("a", "ko", "test:v1").unwrap();
        cache.put("c", "c", "en", "ko", "C", "test:v1").unwrap();
        assert_eq!(cache.memory_size().unwrap(), 2);
        assert!(cache.memory_contains("a", "ko", "test:v1").unwrap());
        assert!(cache.memory_contains("c", "ko", "test:v1").unwrap());
        assert!(!cache.memory_contains("b", "ko", "test:v1").unwrap());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn outgoing_originals_survive_reopening_the_sqlite_cache() {
        let path = temporary_cache_path("outgoing-original");
        let record = OutgoingOriginalRecord {
            message_id: "123456789".to_string(),
            channel_key: "/channels/1/2".to_string(),
            original_text: "오늘은 조금 늦을 것 같아".to_string(),
            sent_text: "I think I'll be a little late today".to_string(),
            part_number: 1,
            total_parts: 1,
            created_at: super::now_seconds(),
        };
        {
            let cache = TranslationCache::open(path.clone(), 8).unwrap();
            cache.put_outgoing_original(&record).unwrap();
        }

        let reopened = TranslationCache::open(path.clone(), 8).unwrap();
        let loaded = reopened
            .outgoing_originals_for_channel("/channels/1/2", 20)
            .unwrap();

        assert_eq!(loaded, vec![record]);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
