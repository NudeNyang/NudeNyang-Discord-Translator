use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::language::{detect_language, is_supported_language_code, Language, LANGUAGE_MENU_ORDER};

const STARTER_PACKS_JSON: &str = include_str!("../dictionary-packs/starter.json");
const PACK_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarterCatalog {
    schema_version: u32,
    packs: Vec<StarterPack>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarterPack {
    id: String,
    language: String,
    version: String,
    title: String,
    source_name: String,
    source_url: String,
    license: String,
    entries: Vec<StarterEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarterEntry {
    headword: String,
    #[serde(default)]
    reading: String,
    part_of_speech: String,
    glosses: HashMap<String, String>,
    #[serde(default)]
    examples: HashMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub headword: String,
    pub language: String,
    pub reading: String,
    pub part_of_speech: String,
    pub definition: String,
    pub example: String,
    pub source_name: String,
    pub source_url: String,
    pub license: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryLookupResult {
    pub query: String,
    pub source_language: String,
    pub target_language: String,
    pub entries: Vec<DictionaryEntry>,
    pub personal_entries: Vec<PersonalDictionaryEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDictionaryEntry {
    #[serde(default)]
    pub id: i64,
    pub source_language: String,
    pub target_language: String,
    pub source_term: String,
    pub target_term: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_scope")]
    pub scope: String,
    #[serde(default)]
    pub scope_value: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_true")]
    pub whole_word: bool,
    #[serde(default)]
    pub created_at: f64,
    #[serde(default)]
    pub updated_at: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryPackStatus {
    pub id: String,
    pub language: String,
    pub language_name: String,
    pub version: String,
    pub title: String,
    pub availability: String,
    pub installed: bool,
    pub entry_count: u64,
    pub license: String,
    pub source_url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStatus {
    pub database_bytes: u64,
    pub personal_entry_count: u64,
    pub installed_pack_count: u64,
    pub packs: Vec<DictionaryPackStatus>,
}

pub struct DictionaryStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl DictionaryStore {
    pub fn open_default() -> Result<Self, String> {
        Self::open(default_dictionary_path())
    }

    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "사전 데이터 폴더를 만들지 못했습니다 ({}): {error}",
                    parent.display()
                )
            })?;
        }
        let connection = Connection::open(&path).map_err(|error| {
            format!(
                "사전 저장소를 열지 못했습니다 ({}): {error}",
                path.display()
            )
        })?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("사전 SQLite 대기 시간을 설정하지 못했습니다: {error}"))?;
        initialize_schema(&connection)?;
        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    pub fn lookup(
        &self,
        query: &str,
        source_language: Option<&str>,
        target_language: &str,
    ) -> Result<DictionaryLookupResult, String> {
        let query = validate_term(query, "조회할 단어")?;
        let requested_language = source_language
            .filter(|value| is_supported_language_code(value))
            .unwrap_or("");
        let detected = if requested_language.is_empty() {
            let detected = detect_language(&query).language;
            if detected == Language::Unknown {
                String::new()
            } else {
                detected.code().to_string()
            }
        } else {
            requested_language.to_string()
        };
        let target_language = if is_supported_language_code(target_language) {
            target_language
        } else {
            "en"
        };

        if !detected.is_empty() {
            self.install_starter_pack_if_available(&detected)?;
        }
        let normalized = normalize_term(&query);
        let connection = self
            .connection
            .lock()
            .map_err(|_| "사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT e.headword, e.language, e.reading, e.part_of_speech, \
                        COALESCE(g_target.text, g_en.text, g_any.text, ''), \
                        COALESCE(x_target.text, x_en.text, x_any.text, ''), \
                        p.source_name, p.source_url, p.license \
                 FROM dictionary_entries e \
                 JOIN dictionary_packs p ON p.id=e.pack_id \
                 LEFT JOIN dictionary_text g_target ON g_target.entry_id=e.id AND g_target.kind='gloss' AND g_target.locale=?1 \
                 LEFT JOIN dictionary_text g_en ON g_en.entry_id=e.id AND g_en.kind='gloss' AND g_en.locale='en' \
                 LEFT JOIN dictionary_text g_any ON g_any.id=(SELECT id FROM dictionary_text WHERE entry_id=e.id AND kind='gloss' ORDER BY locale LIMIT 1) \
                 LEFT JOIN dictionary_text x_target ON x_target.entry_id=e.id AND x_target.kind='example' AND x_target.locale=?1 \
                 LEFT JOIN dictionary_text x_en ON x_en.entry_id=e.id AND x_en.kind='example' AND x_en.locale='en' \
                 LEFT JOIN dictionary_text x_any ON x_any.id=(SELECT id FROM dictionary_text WHERE entry_id=e.id AND kind='example' ORDER BY locale LIMIT 1) \
                 WHERE e.normalized_headword=?2 AND (?3='' OR e.language=?3) \
                 ORDER BY CASE WHEN e.language=?3 THEN 0 ELSE 1 END, e.id LIMIT 12",
            )
            .map_err(|error| format!("사전 조회를 준비하지 못했습니다: {error}"))?;
        let entries = statement
            .query_map(params![target_language, normalized, detected], |row| {
                Ok(DictionaryEntry {
                    headword: row.get(0)?,
                    language: row.get(1)?,
                    reading: row.get(2)?,
                    part_of_speech: row.get(3)?,
                    definition: row.get(4)?,
                    example: row.get(5)?,
                    source_name: row.get(6)?,
                    source_url: row.get(7)?,
                    license: row.get(8)?,
                })
            })
            .map_err(|error| format!("사전을 조회하지 못했습니다: {error}"))?
            .map(|row| row.map_err(|error| format!("사전 항목을 읽지 못했습니다: {error}")))
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let mut personal_statement = connection
            .prepare(
                "SELECT id, source_language, target_language, source_term, target_term, note, \
                        scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
                 FROM personal_dictionary \
                 WHERE normalized_source_term=?1 AND (?2='' OR source_language=?2) \
                   AND (target_language=?3 OR target_language='*') \
                 ORDER BY updated_at DESC LIMIT 12",
            )
            .map_err(|error| format!("개인 사전 조회를 준비하지 못했습니다: {error}"))?;
        let personal_entries = personal_statement
            .query_map(
                params![normalize_term(&query), detected, target_language],
                personal_from_row,
            )
            .map_err(|error| format!("개인 사전을 조회하지 못했습니다: {error}"))?
            .map(|row| row.map_err(|error| format!("개인 사전 항목을 읽지 못했습니다: {error}")))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(DictionaryLookupResult {
            query,
            source_language: detected,
            target_language: target_language.to_string(),
            entries,
            personal_entries,
        })
    }

    pub fn personal_entries(&self) -> Result<Vec<PersonalDictionaryEntry>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT id, source_language, target_language, source_term, target_term, note, \
                        scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
                 FROM personal_dictionary ORDER BY updated_at DESC, id DESC",
            )
            .map_err(|error| format!("개인 사전 목록 조회를 준비하지 못했습니다: {error}"))?;
        let rows = statement
            .query_map([], personal_from_row)
            .map_err(|error| format!("개인 사전 목록을 조회하지 못했습니다: {error}"))?;
        rows.map(|row| row.map_err(|error| format!("개인 사전 항목을 읽지 못했습니다: {error}")))
            .collect()
    }

    pub fn upsert_personal(
        &self,
        mut entry: PersonalDictionaryEntry,
    ) -> Result<PersonalDictionaryEntry, String> {
        if !is_supported_language_code(&entry.source_language) {
            return Err("개인 사전의 원문 언어가 올바르지 않습니다.".to_string());
        }
        if entry.target_language != "*" && !is_supported_language_code(&entry.target_language) {
            return Err("개인 사전의 대상 언어가 올바르지 않습니다.".to_string());
        }
        entry.source_term = validate_term(&entry.source_term, "원문 용어")?;
        entry.target_term = validate_term(&entry.target_term, "대상 용어")?;
        entry.note = entry.note.trim().chars().take(500).collect();
        if !matches!(entry.scope.as_str(), "global" | "server" | "channel") {
            entry.scope = default_scope();
        }
        if entry.scope == "global" {
            entry.scope_value.clear();
        } else if !entry.scope_value.starts_with("/channels/") {
            return Err("서버 또는 채널 적용 범위가 올바르지 않습니다.".to_string());
        }
        let now = now_seconds();
        let normalized = normalize_term(&entry.source_term);
        let connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        if entry.id > 0 {
            let changed = connection
                .execute(
                    "UPDATE personal_dictionary SET source_language=?1, target_language=?2, source_term=?3, \
                       normalized_source_term=?4, target_term=?5, note=?6, scope=?7, scope_value=?8, \
                       case_sensitive=?9, whole_word=?10, updated_at=?11 WHERE id=?12",
                    params![entry.source_language, entry.target_language, entry.source_term, normalized,
                        entry.target_term, entry.note, entry.scope, entry.scope_value,
                        entry.case_sensitive, entry.whole_word, now, entry.id],
                )
                .map_err(|error| format!("개인 사전 항목을 수정하지 못했습니다: {error}"))?;
            if changed == 0 {
                return Err("수정할 개인 사전 항목을 찾지 못했습니다.".to_string());
            }
        } else {
            connection
                .execute(
                    "INSERT INTO personal_dictionary \
                     (source_language, target_language, source_term, normalized_source_term, target_term, note, \
                      scope, scope_value, case_sensitive, whole_word, created_at, updated_at) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11) \
                     ON CONFLICT(source_language, target_language, normalized_source_term, scope, scope_value) \
                     DO UPDATE SET source_term=excluded.source_term, target_term=excluded.target_term, note=excluded.note, \
                       case_sensitive=excluded.case_sensitive, whole_word=excluded.whole_word, updated_at=excluded.updated_at",
                    params![entry.source_language, entry.target_language, entry.source_term, normalized,
                        entry.target_term, entry.note, entry.scope, entry.scope_value,
                        entry.case_sensitive, entry.whole_word, now],
                )
                .map_err(|error| format!("개인 사전 항목을 저장하지 못했습니다: {error}"))?;
            entry.id = connection
                .query_row(
                    "SELECT id FROM personal_dictionary WHERE source_language=?1 AND target_language=?2 \
                     AND normalized_source_term=?3 AND scope=?4 AND scope_value=?5",
                    params![entry.source_language, entry.target_language, normalized, entry.scope, entry.scope_value],
                    |row| row.get(0),
                )
                .map_err(|error| format!("저장한 개인 사전 항목을 찾지 못했습니다: {error}"))?;
        }
        entry.created_at = connection
            .query_row(
                "SELECT created_at FROM personal_dictionary WHERE id=?1",
                params![entry.id],
                |row| row.get(0),
            )
            .unwrap_or(now);
        entry.updated_at = now;
        Ok(entry)
    }

    pub fn delete_personal(&self, id: i64) -> Result<bool, String> {
        if id <= 0 {
            return Err("삭제할 개인 사전 항목이 올바르지 않습니다.".to_string());
        }
        self.connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?
            .execute("DELETE FROM personal_dictionary WHERE id=?1", params![id])
            .map(|changed| changed > 0)
            .map_err(|error| format!("개인 사전 항목을 삭제하지 못했습니다: {error}"))
    }

    pub fn install_bundled_pack(&self, language: &str) -> Result<DictionaryPackStatus, String> {
        if !is_supported_language_code(language) {
            return Err("설치할 사전팩의 언어가 올바르지 않습니다.".to_string());
        }
        let catalog = starter_catalog()?;
        let pack = catalog
            .packs
            .iter()
            .find(|pack| pack.language == language)
            .ok_or_else(|| "이 언어의 스타터 사전팩은 아직 준비되지 않았습니다.".to_string())?;
        self.install_pack(pack)?;
        self.pack_status(language)?
            .ok_or_else(|| "설치한 사전팩 상태를 확인하지 못했습니다.".to_string())
    }

    pub fn remove_pack(&self, language: &str) -> Result<bool, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "사전팩 저장소 잠금을 열지 못했습니다.".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("사전팩 삭제를 시작하지 못했습니다: {error}"))?;
        let pack_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM dictionary_packs WHERE language=?1",
                params![language],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("삭제할 사전팩을 찾지 못했습니다: {error}"))?;
        let Some(pack_id) = pack_id else {
            return Ok(false);
        };
        transaction
            .execute("DELETE FROM dictionary_packs WHERE id=?1", params![pack_id])
            .map_err(|error| format!("사전팩을 삭제하지 못했습니다: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("사전팩 삭제를 완료하지 못했습니다: {error}"))?;
        Ok(true)
    }

    pub fn status(&self) -> Result<DictionaryStatus, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let personal_entry_count = connection
            .query_row("SELECT COUNT(*) FROM personal_dictionary", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("개인 사전 용량을 확인하지 못했습니다: {error}"))?;
        let installed_pack_count = connection
            .query_row("SELECT COUNT(*) FROM dictionary_packs", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("설치된 사전팩 수를 확인하지 못했습니다: {error}"))?;
        drop(connection);
        Ok(DictionaryStatus {
            database_bytes: std::fs::metadata(&self.path)
                .map(|value| value.len())
                .unwrap_or(0),
            personal_entry_count,
            installed_pack_count,
            packs: self.pack_catalog()?,
        })
    }

    pub fn pack_catalog(&self) -> Result<Vec<DictionaryPackStatus>, String> {
        let starters = starter_catalog()?;
        let mut result = Vec::with_capacity(LANGUAGE_MENU_ORDER.len());
        for language in LANGUAGE_MENU_ORDER {
            let code = language.code();
            let bundled = starters.packs.iter().find(|pack| pack.language == code);
            let installed = self.pack_status(code)?.map(|mut pack| {
                pack.availability = if bundled.is_some() {
                    "bundled"
                } else {
                    "installed"
                }
                .to_string();
                pack
            });
            result.push(installed.unwrap_or_else(|| {
                DictionaryPackStatus {
                    id: bundled
                        .map(|pack| pack.id.clone())
                        .unwrap_or_else(|| format!("wiktionary-{code}")),
                    language: code.to_string(),
                    language_name: language.english_name().to_string(),
                    version: bundled.map(|pack| pack.version.clone()).unwrap_or_default(),
                    title: bundled
                        .map(|pack| pack.title.clone())
                        .unwrap_or_else(|| format!("{} dictionary pack", language.english_name())),
                    availability: if bundled.is_some() {
                        "bundled"
                    } else {
                        "planned"
                    }
                    .to_string(),
                    installed: false,
                    entry_count: 0,
                    license: bundled
                        .map(|pack| pack.license.clone())
                        .unwrap_or_else(|| "CC BY-SA / GFDL source review required".to_string()),
                    source_url: bundled
                        .map(|pack| pack.source_url.clone())
                        .unwrap_or_else(|| "https://kaikki.org/dictionary/".to_string()),
                }
            }));
        }
        Ok(result)
    }

    fn pack_status(&self, language: &str) -> Result<Option<DictionaryPackStatus>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "사전팩 저장소 잠금을 열지 못했습니다.".to_string())?;
        connection
            .query_row(
                "SELECT id, language, version, title, entry_count, license, source_url \
                 FROM dictionary_packs WHERE language=?1",
                params![language],
                |row| {
                    let code: String = row.get(1)?;
                    let name = Language::try_from(code.as_str())
                        .map(Language::english_name)
                        .unwrap_or("Unknown");
                    Ok(DictionaryPackStatus {
                        id: row.get(0)?,
                        language: code,
                        language_name: name.to_string(),
                        version: row.get(2)?,
                        title: row.get(3)?,
                        availability: "installed".to_string(),
                        installed: true,
                        entry_count: row.get(4)?,
                        license: row.get(5)?,
                        source_url: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("사전팩 상태를 확인하지 못했습니다: {error}"))
    }

    fn install_starter_pack_if_available(&self, language: &str) -> Result<(), String> {
        if self.pack_status(language)?.is_some() {
            return Ok(());
        }
        let catalog = starter_catalog()?;
        if let Some(pack) = catalog.packs.iter().find(|pack| pack.language == language) {
            self.install_pack(pack)?;
        }
        Ok(())
    }

    fn install_pack(&self, pack: &StarterPack) -> Result<(), String> {
        if !is_supported_language_code(&pack.language) {
            return Err(format!(
                "지원하지 않는 사전팩 언어입니다: {}",
                pack.language
            ));
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "사전팩 저장소 잠금을 열지 못했습니다.".to_string())?;
        let current_version: Option<String> = connection
            .query_row(
                "SELECT version FROM dictionary_packs WHERE id=?1",
                params![pack.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("사전팩 버전을 확인하지 못했습니다: {error}"))?;
        if current_version.as_deref() == Some(pack.version.as_str()) {
            return Ok(());
        }
        let transaction = connection
            .transaction()
            .map_err(|error| format!("사전팩 설치를 시작하지 못했습니다: {error}"))?;
        transaction
            .execute(
                "DELETE FROM dictionary_packs WHERE language=?1",
                params![pack.language],
            )
            .map_err(|error| format!("이전 사전팩을 정리하지 못했습니다: {error}"))?;
        transaction
            .execute(
                "INSERT INTO dictionary_packs (id, language, version, title, source_name, source_url, license, entry_count, installed_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![pack.id, pack.language, pack.version, pack.title, pack.source_name,
                    pack.source_url, pack.license, pack.entries.len() as u64, now_seconds()],
            )
            .map_err(|error| format!("사전팩 정보를 저장하지 못했습니다: {error}"))?;
        for entry in &pack.entries {
            transaction
                .execute(
                    "INSERT INTO dictionary_entries (pack_id, language, headword, normalized_headword, reading, part_of_speech) \
                     VALUES (?1,?2,?3,?4,?5,?6)",
                    params![pack.id, pack.language, entry.headword, normalize_term(&entry.headword), entry.reading, entry.part_of_speech],
                )
                .map_err(|error| format!("사전 항목을 저장하지 못했습니다: {error}"))?;
            let entry_id = transaction.last_insert_rowid();
            for (locale, text) in &entry.glosses {
                transaction.execute(
                    "INSERT INTO dictionary_text (entry_id, kind, locale, text) VALUES (?1,'gloss',?2,?3)",
                    params![entry_id, locale, text],
                ).map_err(|error| format!("사전 뜻을 저장하지 못했습니다: {error}"))?;
            }
            for (locale, text) in &entry.examples {
                transaction.execute(
                    "INSERT INTO dictionary_text (entry_id, kind, locale, text) VALUES (?1,'example',?2,?3)",
                    params![entry_id, locale, text],
                ).map_err(|error| format!("사전 예문을 저장하지 못했습니다: {error}"))?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("사전팩 설치를 완료하지 못했습니다: {error}"))
    }
}

fn starter_catalog() -> Result<StarterCatalog, String> {
    let catalog: StarterCatalog = serde_json::from_str(STARTER_PACKS_JSON)
        .map_err(|error| format!("내장 사전팩을 읽지 못했습니다: {error}"))?;
    if catalog.schema_version != PACK_SCHEMA_VERSION {
        return Err(format!(
            "지원하지 않는 사전팩 형식입니다: {}",
            catalog.schema_version
        ));
    }
    Ok(catalog)
}

fn personal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersonalDictionaryEntry> {
    Ok(PersonalDictionaryEntry {
        id: row.get(0)?,
        source_language: row.get(1)?,
        target_language: row.get(2)?,
        source_term: row.get(3)?,
        target_term: row.get(4)?,
        note: row.get(5)?,
        scope: row.get(6)?,
        scope_value: row.get(7)?,
        case_sensitive: row.get(8)?,
        whole_word: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; \
         CREATE TABLE IF NOT EXISTS dictionary_packs ( \
           id TEXT PRIMARY KEY, language TEXT NOT NULL UNIQUE, version TEXT NOT NULL, title TEXT NOT NULL, \
           source_name TEXT NOT NULL, source_url TEXT NOT NULL, license TEXT NOT NULL, \
           entry_count INTEGER NOT NULL, installed_at REAL NOT NULL); \
         CREATE TABLE IF NOT EXISTS dictionary_entries ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL REFERENCES dictionary_packs(id) ON DELETE CASCADE, \
           language TEXT NOT NULL, headword TEXT NOT NULL, normalized_headword TEXT NOT NULL, \
           reading TEXT NOT NULL DEFAULT '', part_of_speech TEXT NOT NULL DEFAULT 'other'); \
         CREATE INDEX IF NOT EXISTS idx_dictionary_lookup ON dictionary_entries(normalized_headword, language); \
         CREATE TABLE IF NOT EXISTS dictionary_text ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE, \
           kind TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(entry_id, kind, locale)); \
         CREATE TABLE IF NOT EXISTS personal_dictionary ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, source_language TEXT NOT NULL, target_language TEXT NOT NULL, \
           source_term TEXT NOT NULL, normalized_source_term TEXT NOT NULL, target_term TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', \
           scope TEXT NOT NULL DEFAULT 'global', scope_value TEXT NOT NULL DEFAULT '', case_sensitive INTEGER NOT NULL DEFAULT 0, \
           whole_word INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, updated_at REAL NOT NULL, \
           UNIQUE(source_language, target_language, normalized_source_term, scope, scope_value)); \
         CREATE INDEX IF NOT EXISTS idx_personal_dictionary_lookup \
           ON personal_dictionary(normalized_source_term, source_language, target_language);"
    ).map_err(|error| format!("사전 저장소 테이블을 만들지 못했습니다: {error}"))
}

fn validate_term(value: &str, label: &str) -> Result<String, String> {
    let value = value
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let length = value.chars().count();
    if length == 0 {
        return Err(format!("{label}을 입력하십시오."));
    }
    if length > 120 {
        return Err(format!("{label}은 120자 이하로 입력하십시오."));
    }
    Ok(value)
}

fn normalize_term(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn default_scope() -> String {
    "global".to_string()
}
fn default_true() -> bool {
    true
}

pub fn dictionary_storage_root() -> PathBuf {
    default_dictionary_path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_dictionary_path() -> PathBuf {
    if let Some(path) = env::var_os("NUDENYANG_DICTIONARY_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        return PathBuf::from(local_app_data)
            .join("LocalTools")
            .join("NudeNyang Discord Translator")
            .join("Dictionary")
            .join("dictionary.db");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("NudeNyang Discord Translator")
            .join("Dictionary")
            .join("dictionary.db");
    }
    env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .unwrap_or_else(|| PathBuf::from("."))
        .join("NudeNyang Discord Translator")
        .join("Dictionary")
        .join("dictionary.db")
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::{DictionaryStore, PersonalDictionaryEntry};

    fn temporary_store(name: &str) -> DictionaryStore {
        let path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-{name}-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        DictionaryStore::open(path).unwrap()
    }

    #[test]
    fn starter_pack_installs_lazily_and_returns_localized_gloss() {
        let store = temporary_store("starter");
        let result = store.lookup("future", Some("en"), "ko").unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(
            result.entries[0].definition,
            "현재 이후의 시간 또는 앞으로 일어날 일."
        );
        assert_eq!(store.status().unwrap().installed_pack_count, 1);
        let installed = store
            .pack_catalog()
            .unwrap()
            .into_iter()
            .find(|pack| pack.language == "en")
            .unwrap();
        assert!(installed.installed);
        assert_eq!(installed.availability, "bundled");
    }

    #[test]
    fn personal_terms_are_saved_and_found_for_the_language_pair() {
        let store = temporary_store("personal");
        let saved = store
            .upsert_personal(PersonalDictionaryEntry {
                id: 0,
                source_language: "en".into(),
                target_language: "ko".into(),
                source_term: "BugCat".into(),
                target_term: "누드냥".into(),
                note: "캐릭터명".into(),
                scope: "global".into(),
                scope_value: String::new(),
                case_sensitive: true,
                whole_word: true,
                created_at: 0.0,
                updated_at: 0.0,
            })
            .unwrap();
        assert!(saved.id > 0);
        let result = store.lookup("BugCat", Some("en"), "ko").unwrap();
        assert_eq!(result.personal_entries[0].target_term, "누드냥");
        assert!(store.delete_personal(saved.id).unwrap());
    }

    #[test]
    fn catalog_covers_all_product_languages() {
        let store = temporary_store("catalog");
        let catalog = store.pack_catalog().unwrap();
        assert_eq!(catalog.len(), 28);
        assert_eq!(
            catalog
                .iter()
                .filter(|pack| pack.availability == "bundled")
                .count(),
            5
        );
    }
}
