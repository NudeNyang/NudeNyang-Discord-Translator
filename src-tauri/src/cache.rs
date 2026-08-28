use std::collections::{HashMap, VecDeque};
use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::language::is_supported_language_code;

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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStorageStatus {
    pub database_bytes: u64,
    pub translation_records: u64,
    pub outgoing_original_records: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanupResult {
    pub removed_records: u64,
    pub bytes_before: u64,
    pub bytes_after: u64,
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
    path: PathBuf,
    connection: Mutex<Connection>,
    memory: Mutex<MemoryCache>,
    memory_capacity: usize,
}

impl TranslationCache {
    /// Request-scoped storage for private conversations. No database, journal or
    /// temporary sorting data is written to disk, even if the LRU fills up.
    pub fn in_memory(memory_capacity: usize) -> Result<Self, String> {
        let mut connection = Connection::open_in_memory()
            .map_err(|_| "개인 대화용 임시 번역 캐시를 만들지 못했습니다.".to_string())?;
        connection
            .execute_batch("PRAGMA temp_store=MEMORY;")
            .map_err(|_| "개인 대화용 임시 번역 캐시를 설정하지 못했습니다.".to_string())?;
        initialize_schema(&mut connection)?;
        Ok(Self {
            path: PathBuf::new(),
            connection: Mutex::new(connection),
            memory: Mutex::new(MemoryCache::default()),
            memory_capacity,
        })
    }

    pub fn open_default() -> Result<Self, String> {
        // Unit-test engine workers must never migrate, read or write the user's
        // real history. Persistence/encryption tests use explicit temporary paths.
        if cfg!(test) {
            return Self::in_memory(4096);
        }
        Self::open(default_cache_path(), 4096)
    }

    pub fn open(path: PathBuf, memory_capacity: usize) -> Result<Self, String> {
        // Windows is the supported desktop target. Other platforms remain
        // memory-only until an OS-backed encryption implementation is available.
        if !cfg!(windows) {
            return Self::in_memory(memory_capacity);
        }
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
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("SQLite 대기 시간을 설정하지 못했습니다: {error}"))?;
        initialize_schema(&mut connection)?;
        protect_legacy_bodies(&mut connection)?;
        Ok(Self {
            path,
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
        Ok(self
            .get_entry(source_hash, target_language, translator)?
            .map(|entry| entry.translated_text))
    }

    fn get_entry(
        &self,
        source_hash: &str,
        target_language: &str,
        translator: &str,
    ) -> Result<Option<CacheEntry>, String> {
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
            return Ok(Some(entry));
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
                            source_text: read_body(row, 0)?,
                            source_language: row.get(1)?,
                            target_language: target_language.to_string(),
                            translator: translator.to_string(),
                            translated_text: read_body(row, 2)?,
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
        self.remember(entry.clone())?;
        Ok(Some(entry))
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
        if let Some(exact) = self.get_entry(source_hash, target_language, translator)? {
            if exact.source_language == source_language {
                return Ok(Some(exact.translated_text));
            }
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
                            source_text: read_body(row, 1)?,
                            source_language: source_language.to_string(),
                            target_language: target_language.to_string(),
                            translator: translator.to_string(),
                            translated_text: read_body(row, 2)?,
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
        let source_payload = self.body_payload(source_text)?;
        let translated_payload = self.body_payload(translated_text)?;
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
                    source_payload,
                    entry.source_language,
                    entry.target_language,
                    entry.translator,
                    translated_payload,
                    entry.updated_at,
                ],
            )
            .map_err(|error| format!("번역 캐시를 저장하지 못했습니다: {error}"))?;
        self.remember(entry)?;
        Ok(())
    }

    fn body_payload(&self, text: &str) -> Result<rusqlite::types::Value, String> {
        if self.path.as_os_str().is_empty() {
            Ok(rusqlite::types::Value::Text(text.to_string()))
        } else {
            crate::cache_crypto::encrypt(text).map(rusqlite::types::Value::Blob)
        }
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

    pub fn storage_status(&self) -> Result<CacheStorageStatus, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "SQLite 번역 캐시 잠금을 열지 못했습니다.".to_string())?;
        let translation_records = table_row_count(&connection, "translations")?;
        let outgoing_original_records = table_row_count(&connection, "outgoing_originals")?;
        drop(connection);
        Ok(CacheStorageStatus {
            database_bytes: std::fs::metadata(&self.path)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            translation_records,
            outgoing_original_records,
        })
    }

    pub fn clear_user_data(&self) -> Result<CacheCleanupResult, String> {
        self.cleanup_user_data_before(None)
    }

    pub fn cleanup_expired_records(
        &self,
        retention_days: u32,
    ) -> Result<CacheCleanupResult, String> {
        if retention_days == 0 {
            let status = self.storage_status()?;
            return Ok(CacheCleanupResult {
                removed_records: 0,
                bytes_before: status.database_bytes,
                bytes_after: status.database_bytes,
            });
        }
        let cutoff = now_seconds() - f64::from(retention_days) * 24.0 * 60.0 * 60.0;
        self.cleanup_user_data_before(Some(cutoff))
    }

    fn cleanup_user_data_before(&self, cutoff: Option<f64>) -> Result<CacheCleanupResult, String> {
        let before = self.storage_status()?;
        let removed_records;
        {
            let mut connection = self
                .connection
                .lock()
                .map_err(|_| "SQLite 번역 캐시 잠금을 열지 못했습니다.".to_string())?;
            let transaction = connection
                .transaction()
                .map_err(|error| format!("번역 기록 정리를 시작하지 못했습니다: {error}"))?;
            let removed_translations = if let Some(cutoff) = cutoff {
                transaction.execute(
                    "DELETE FROM translations WHERE updated_at < ?1",
                    params![cutoff],
                )
            } else {
                transaction.execute("DELETE FROM translations", [])
            }
            .map_err(|error| format!("번역 결과를 정리하지 못했습니다: {error}"))?;
            let removed_outgoing_originals = if let Some(cutoff) = cutoff {
                transaction.execute(
                    "DELETE FROM outgoing_originals WHERE created_at < ?1",
                    params![cutoff],
                )
            } else {
                transaction.execute("DELETE FROM outgoing_originals", [])
            }
            .map_err(|error| format!("보낸 메시지 원문을 정리하지 못했습니다: {error}"))?;
            removed_records = (removed_translations + removed_outgoing_originals) as u64;
            transaction
                .commit()
                .map_err(|error| format!("번역 기록 정리를 완료하지 못했습니다: {error}"))?;
            if removed_records > 0 {
                if let Err(error) = connection.execute_batch("VACUUM") {
                    crate::diagnostics::warn(
                        "translation-cache",
                        &format!("SQLite records cleared but compaction was deferred: {error}"),
                    );
                }
            }
        }
        if removed_records > 0 {
            self.clear_memory()?;
        }
        Ok(CacheCleanupResult {
            removed_records,
            bytes_before: before.database_bytes,
            bytes_after: std::fs::metadata(&self.path)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
        })
    }

    pub fn clear_memory(&self) -> Result<(), String> {
        *self
            .memory
            .lock()
            .map_err(|_| "메모리 번역 캐시 잠금을 열지 못했습니다.".to_string())? =
            MemoryCache::default();
        Ok(())
    }

    pub fn put_outgoing_original(&self, record: &OutgoingOriginalRecord) -> Result<(), String> {
        let original_payload = self.body_payload(&record.original_text)?;
        let sent_payload = self.body_payload(&record.sent_text)?;
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
                    original_payload,
                    sent_payload,
                    record.part_number,
                    record.total_parts,
                    record.created_at,
                ],
            )
            .map_err(|error| format!("보낸 메시지 원문을 저장하지 못했습니다: {error}"))?;
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
                    original_text: read_body(row, 2)?,
                    sent_text: read_body(row, 3)?,
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

    pub fn set_outgoing_channel_language(
        &self,
        channel_key: &str,
        language: &str,
    ) -> Result<(), String> {
        if !channel_key.starts_with("/channels/") {
            return Err("채널별 전송 언어를 저장할 Discord 채널을 찾지 못했습니다.".to_string());
        }
        if language != "auto" && !is_supported_language_code(language) {
            return Err("채널별 전송 언어 값이 올바르지 않습니다.".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "채널별 전송 언어 저장소 잠금을 열지 못했습니다.".to_string())?;
        connection
            .execute(
                "INSERT INTO outgoing_channel_languages (channel_key, language, updated_at) \
                 VALUES (?1, ?2, ?3) \
                 ON CONFLICT(channel_key) DO UPDATE SET \
                   language=excluded.language, updated_at=excluded.updated_at",
                params![channel_key, language, now_seconds()],
            )
            .map_err(|error| format!("채널별 전송 언어를 저장하지 못했습니다: {error}"))?;
        Ok(())
    }

    pub fn outgoing_channel_languages(&self) -> Result<HashMap<String, String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "채널별 전송 언어 저장소 잠금을 열지 못했습니다.".to_string())?;
        let mut statement = connection
            .prepare("SELECT channel_key, language FROM outgoing_channel_languages")
            .map_err(|error| format!("채널별 전송 언어 조회를 준비하지 못했습니다: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("채널별 전송 언어를 조회하지 못했습니다: {error}"))?;
        rows.map(|row| {
            row.map_err(|error| format!("채널별 전송 언어 행을 읽지 못했습니다: {error}"))
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

fn table_row_count(connection: &Connection, table: &str) -> Result<u64, String> {
    let query = match table {
        "translations" => "SELECT COUNT(*) FROM translations",
        "outgoing_originals" => "SELECT COUNT(*) FROM outgoing_originals",
        _ => return Err("지원하지 않는 SQLite 테이블입니다.".to_string()),
    };
    connection
        .query_row(query, [], |row| row.get(0))
        .map_err(|error| format!("SQLite 저장 정보를 확인하지 못했습니다: {error}"))
}

// SQLite's value type distinguishes encrypted BLOBs from legacy TEXT. A
// user's source beginning with an encryption-looking prefix is still plain text.
fn read_body(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<String> {
    use rusqlite::types::{Type, ValueRef};
    match row.get_ref(index)? {
        ValueRef::Text(_) => row.get(index),
        ValueRef::Blob(bytes) => crate::cache_crypto::decrypt(bytes).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                Type::Blob,
                std::io::Error::other("암호화된 번역 캐시를 읽지 못했습니다.").into(),
            )
        }),
        _ => Err(rusqlite::Error::InvalidColumnType(
            index,
            "body".into(),
            row.get_ref(index)?.data_type(),
        )),
    }
}

fn protect_legacy_bodies(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY;")
        .map_err(|_| "캐시 보호 설정에 실패했습니다.")?;
    connection.execute_batch("CREATE INDEX IF NOT EXISTS translations_plaintext ON translations(source_hash) WHERE typeof(source_text)='text' OR typeof(translated_text)='text';
        CREATE INDEX IF NOT EXISTS outgoing_plaintext ON outgoing_originals(message_id) WHERE typeof(original_text)='text' OR typeof(sent_text)='text';")
        .map_err(|_| "캐시 보호 색인을 만들지 못했습니다.")?;
    let has_plaintext: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM translations WHERE typeof(source_text)='text' OR typeof(translated_text)='text') OR EXISTS(SELECT 1 FROM outgoing_originals WHERE typeof(original_text)='text' OR typeof(sent_text)='text')", [], |row| row.get(0))
        .map_err(|_| "캐시 보호 상태를 확인하지 못했습니다.")?;
    if !has_plaintext {
        return Ok(());
    }
    // Atomic migration, bounded batches, no plaintext backup. A rollback keeps
    // the old database readable if DPAPI fails. Existing encrypted rows are untouched.
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| "캐시 암호화 전환을 시작하지 못했습니다.")?;
    let mut changed = false;
    for (table, left, right) in [
        ("translations", "source_text", "translated_text"),
        ("outgoing_originals", "original_text", "sent_text"),
    ] {
        loop {
            let records = {
                let mut statement = transaction.prepare(&format!(
                    "SELECT rowid, {left}, {right} FROM {table} WHERE typeof({left})='text' OR typeof({right})='text' LIMIT 256"
                )).map_err(|_| "기존 캐시를 읽지 못했습니다.")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            read_body(row, 1)?,
                            read_body(row, 2)?,
                        ))
                    })
                    .map_err(|_| "기존 캐시를 읽지 못했습니다.")?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|_| "기존 캐시를 읽지 못했습니다.")?
            };
            if records.is_empty() {
                break;
            }
            for (id, first, second) in records {
                let first = crate::cache_crypto::encrypt(&first)?;
                let second = crate::cache_crypto::encrypt(&second)?;
                transaction
                    .execute(
                        &format!("UPDATE {table} SET {left}=?1, {right}=?2 WHERE rowid=?3"),
                        params![first, second, id],
                    )
                    .map_err(|_| "기존 캐시를 암호화하지 못했습니다.")?;
                changed = true;
            }
        }
    }
    transaction
        .commit()
        .map_err(|_| "캐시 암호화 전환을 완료하지 못했습니다.")?;
    if changed {
        connection
            .execute_batch("VACUUM")
            .map_err(|_| "캐시 암호화 후 파일 정리를 완료하지 못했습니다.")?;
    }
    Ok(())
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
             );\
             CREATE TABLE IF NOT EXISTS outgoing_channel_languages (\
               channel_key TEXT NOT NULL PRIMARY KEY,\
               language TEXT NOT NULL,\
               updated_at REAL NOT NULL\
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
            .join("NudeNyang Discord Translator")
            .join("Cache")
            .join("cache.db");
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("NudeNyang Discord Translator")
            .join("cache.db");
    }

    env::var_os("XDG_CACHE_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("NudeNyang Discord Translator")
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
    use std::collections::HashMap;
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
    fn legacy_cache_migrates_both_body_tables_and_preserves_expiry_and_fuzzy_reuse() {
        let path = temporary_cache_path("legacy-encryption");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut legacy = rusqlite::Connection::open(&path).unwrap();
        super::initialize_schema(&mut legacy).unwrap();
        legacy
            .execute(
                "INSERT INTO translations VALUES (?1,?2,'en','ko','test:v1',?3,1)",
                rusqlite::params![
                    "opaque",
                    "Synthetic legacy sentence",
                    "Synthetic legacy translation"
                ],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO outgoing_originals VALUES ('m','/channels/g/c',?1,?2,1,1,1)",
                rusqlite::params!["Synthetic legacy draft", "Synthetic legacy sent"],
            )
            .unwrap();
        drop(legacy);
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        assert_eq!(
            cache.get("opaque", "ko", "test:v1").unwrap().as_deref(),
            Some("Synthetic legacy translation")
        );
        assert_eq!(
            cache
                .get_message(
                    "other",
                    "Synthetic legacy sentencf",
                    "en",
                    "ko",
                    "test:v1",
                    true
                )
                .unwrap()
                .as_deref(),
            Some("Synthetic legacy translation")
        );
        assert_eq!(
            cache
                .outgoing_originals_for_channel("/channels/g/c", 10)
                .unwrap()[0]
                .original_text,
            "Synthetic legacy draft"
        );
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes
            .windows(b"Synthetic legacy".len())
            .any(|part| part == b"Synthetic legacy"));
        // Legacy timestamps are retained; only the newly reused fuzzy entry is fresh.
        assert_eq!(
            cache.cleanup_expired_records(30).unwrap().removed_records,
            2
        );
        assert_eq!(cache.storage_status().unwrap().translation_records, 1);
        drop(cache);
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        assert_eq!(
            cache.get("other", "ko", "test:v1").unwrap().as_deref(),
            Some("Synthetic legacy translation")
        );
        drop(cache);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn shared_cache_encrypts_bodies_and_reopens_without_losing_translations() {
        let path = temporary_cache_path("encrypted-body");
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        cache
            .put(
                "opaque-key",
                "Synthetic private source marker",
                "en",
                "ko",
                "Synthetic translated body marker",
                "test:v1",
            )
            .unwrap();
        drop(cache);
        let database = fs::read(&path).unwrap();
        for body in [
            "Synthetic private source marker",
            "Synthetic translated body marker",
        ] {
            assert!(
                !database
                    .windows(body.len())
                    .any(|bytes| bytes == body.as_bytes()),
                "plaintext body on disk"
            );
        }
        let cache = TranslationCache::open(path.clone(), 32).unwrap();
        assert_eq!(
            cache.get("opaque-key", "ko", "test:v1").unwrap().as_deref(),
            Some("Synthetic translated body marker")
        );
        assert_eq!(cache.clear_user_data().unwrap().removed_records, 1);
        drop(cache);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn private_cache_uses_only_memory_and_does_not_survive_a_new_request() {
        let cache = TranslationCache::in_memory(1).unwrap();
        assert!(cache.path.as_os_str().is_empty());
        {
            let connection = cache.connection.lock().unwrap();
            let database_file: String = connection
                .query_row("PRAGMA database_list", [], |row| row.get(2))
                .unwrap();
            let temp_store: i32 = connection
                .query_row("PRAGMA temp_store", [], |row| row.get(0))
                .unwrap();
            assert_eq!(database_file, "");
            assert_eq!(temp_store, 2);
        }
        cache
            .put("private-1", "hello", "en", "ko", "안녕하세요", "local:test")
            .unwrap();
        cache
            .put(
                "private-2",
                "goodbye",
                "en",
                "ko",
                "안녕히 가십시오",
                "local:test",
            )
            .unwrap();
        cache.clear_memory().unwrap();
        assert_eq!(
            cache
                .get("private-1", "ko", "local:test")
                .unwrap()
                .as_deref(),
            Some("안녕하세요")
        );
        let other_request = TranslationCache::in_memory(1).unwrap();
        assert_eq!(
            other_request.get("private-1", "ko", "local:test").unwrap(),
            None
        );
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
    fn exact_message_lookup_does_not_cross_source_language_boundaries() {
        let path = temporary_cache_path("source-language-isolation");
        let cache = TranslationCache::open(path.clone(), 4096).unwrap();
        cache
            .put("same-hash", "chat", "en", "ko", "대화", "hy:test")
            .unwrap();

        assert_eq!(
            cache
                .get_message("same-hash", "chat", "fr", "ko", "hy:test", false)
                .unwrap(),
            None
        );
        assert_eq!(
            cache
                .get_message("same-hash", "chat", "en", "ko", "hy:test", false)
                .unwrap()
                .as_deref(),
            Some("대화")
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

    #[test]
    fn outgoing_channel_languages_survive_reopening_and_remember_auto() {
        let path = temporary_cache_path("outgoing-channel-language");
        {
            let cache = TranslationCache::open(path.clone(), 8).unwrap();
            cache
                .set_outgoing_channel_language("/channels/1/2", "ja")
                .unwrap();
        }

        let reopened = TranslationCache::open(path.clone(), 8).unwrap();
        assert_eq!(
            reopened.outgoing_channel_languages().unwrap(),
            HashMap::from([("/channels/1/2".to_string(), "ja".to_string())])
        );
        reopened
            .set_outgoing_channel_language("/channels/1/2", "auto")
            .unwrap();
        assert_eq!(
            reopened.outgoing_channel_languages().unwrap(),
            HashMap::from([("/channels/1/2".to_string(), "auto".to_string())])
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn cleanup_removes_translation_history_but_preserves_channel_preferences() {
        let path = temporary_cache_path("cleanup");
        let cache = TranslationCache::open(path.clone(), 8).unwrap();
        cache
            .put("hash", "hello", "en", "ko", "안녕하세요", "test:v1")
            .unwrap();
        cache
            .put_outgoing_original(&OutgoingOriginalRecord {
                message_id: "123".to_string(),
                channel_key: "/channels/1/2".to_string(),
                original_text: "안녕".to_string(),
                sent_text: "hello".to_string(),
                part_number: 1,
                total_parts: 1,
                created_at: super::now_seconds(),
            })
            .unwrap();
        cache
            .set_outgoing_channel_language("/channels/1/2", "ja")
            .unwrap();

        let before = cache.storage_status().unwrap();
        assert_eq!(before.translation_records, 1);
        assert_eq!(before.outgoing_original_records, 1);
        assert_eq!(cache.memory_size().unwrap(), 1);

        let result = cache.clear_user_data().unwrap();
        assert_eq!(result.removed_records, 2);
        assert_eq!(cache.memory_size().unwrap(), 0);
        assert_eq!(cache.get("hash", "ko", "test:v1").unwrap(), None);
        assert!(cache
            .outgoing_originals_for_channel("/channels/1/2", 20)
            .unwrap()
            .is_empty());
        assert_eq!(
            cache.outgoing_channel_languages().unwrap(),
            HashMap::from([("/channels/1/2".to_string(), "ja".to_string())])
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn expired_cleanup_respects_retention_and_preserves_channel_preferences() {
        let path = temporary_cache_path("expired-cleanup");
        let cache = TranslationCache::open(path.clone(), 8).unwrap();
        cache
            .put("old", "old", "en", "ko", "오래됨", "test:v1")
            .unwrap();
        cache
            .put("fresh", "fresh", "en", "ko", "최신", "test:v1")
            .unwrap();
        cache
            .put_outgoing_original(&OutgoingOriginalRecord {
                message_id: "old-message".to_string(),
                channel_key: "/channels/1/2".to_string(),
                original_text: "오래된 원문".to_string(),
                sent_text: "old message".to_string(),
                part_number: 1,
                total_parts: 1,
                created_at: super::now_seconds() - 8.0 * 24.0 * 60.0 * 60.0,
            })
            .unwrap();
        cache
            .put_outgoing_original(&OutgoingOriginalRecord {
                message_id: "fresh-message".to_string(),
                channel_key: "/channels/1/2".to_string(),
                original_text: "최신 원문".to_string(),
                sent_text: "fresh message".to_string(),
                part_number: 1,
                total_parts: 1,
                created_at: super::now_seconds(),
            })
            .unwrap();
        cache
            .set_outgoing_channel_language("/channels/1/2", "ja")
            .unwrap();
        cache
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE translations SET updated_at=?1 WHERE source_hash='old'",
                rusqlite::params![super::now_seconds() - 8.0 * 24.0 * 60.0 * 60.0],
            )
            .unwrap();

        let result = cache.cleanup_expired_records(7).unwrap();
        assert_eq!(result.removed_records, 2);
        assert_eq!(cache.memory_size().unwrap(), 0);
        assert_eq!(cache.get("old", "ko", "test:v1").unwrap(), None);
        assert_eq!(
            cache.get("fresh", "ko", "test:v1").unwrap().as_deref(),
            Some("최신")
        );
        assert_eq!(
            cache
                .outgoing_originals_for_channel("/channels/1/2", 20)
                .unwrap()
                .iter()
                .map(|record| record.message_id.as_str())
                .collect::<Vec<_>>(),
            vec!["fresh-message"]
        );
        assert_eq!(
            cache.outgoing_channel_languages().unwrap(),
            HashMap::from([("/channels/1/2".to_string(), "ja".to_string())])
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
