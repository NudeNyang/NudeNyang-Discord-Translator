use std::collections::{HashMap, HashSet};
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::language::{detect_language, is_supported_language_code, Language, LANGUAGE_MENU_ORDER};

const STARTER_PACKS_JSON: &str = include_str!("../dictionary-packs/starter.json");
const PACK_CATALOG_JSON: &str = include_str!("../dictionary-packs/catalog.json");
const PRACTICAL_EN_GZIP: &[u8] = include_bytes!("../dictionary-packs/practical/en.json.gz");
const PRACTICAL_JA_GZIP: &[u8] = include_bytes!("../dictionary-packs/practical/ja.json.gz");
const PRACTICAL_KO_GZIP: &[u8] = include_bytes!("../dictionary-packs/practical/ko.json.gz");
const PRACTICAL_ZH_GZIP: &[u8] = include_bytes!("../dictionary-packs/practical/zh.json.gz");
const PRACTICAL_ZH_HANT_GZIP: &[u8] =
    include_bytes!("../dictionary-packs/practical/zh-Hant.json.gz");
const PACK_SCHEMA_VERSION: u32 = 1;
const CATALOG_SCHEMA_VERSION: u32 = 2;
const LOCALIZED_TEXT_QUALITY_VERSION: i64 = 1;

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
    #[serde(default = "default_mini_edition")]
    edition: String,
    entries: Vec<StarterEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackCatalog {
    schema_version: u32,
    languages: Vec<PackCatalogLanguage>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackCatalogLanguage {
    code: String,
    availability: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    entry_count: u64,
    #[serde(default)]
    compressed_bytes: u64,
    #[serde(default)]
    sha256: String,
    source: String,
    #[serde(default)]
    source_url: String,
    license: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarterEntry {
    headword: String,
    #[serde(default)]
    reading: String,
    part_of_speech: String,
    #[serde(default)]
    sense_rank: i64,
    glosses: HashMap<String, String>,
    #[serde(default)]
    examples: HashMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    #[serde(skip)]
    pub entry_id: i64,
    pub headword: String,
    pub language: String,
    pub reading: String,
    pub part_of_speech: String,
    #[serde(skip)]
    pub sense_rank: i64,
    pub context_recommended: bool,
    pub definition: String,
    pub definition_language: String,
    pub definition_origin: String,
    pub original_definition: String,
    pub original_definition_language: String,
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
    pub selection_translation: String,
    pub localization_pending: bool,
    pub segmented: bool,
    pub entries: Vec<DictionaryEntry>,
    pub personal_entries: Vec<PersonalDictionaryEntry>,
}

impl DictionaryLookupResult {
    pub fn needs_localization(&self) -> bool {
        self.entries.iter().any(|entry| {
            !entry.definition.is_empty()
                && entry.definition_origin == "original"
                && entry.definition_language != self.target_language
        })
    }

    pub fn needs_selection_translation(&self) -> bool {
        !self.query.trim().is_empty()
            && self.source_language != self.target_language
            && self.selection_translation.is_empty()
    }

    pub fn rerank_for_context(&mut self, context: &str) {
        rank_entries_for_context(&mut self.entries, context);
    }
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
    pub edition: String,
    pub installed: bool,
    pub entry_count: u64,
    pub available_entry_count: u64,
    pub compressed_bytes: u64,
    pub sha256: String,
    pub source_name: String,
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
        self.lookup_with_context(query, "", source_language, target_language)
    }

    pub fn lookup_with_context(
        &self,
        query: &str,
        context: &str,
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
        let exact_terms = vec![normalized.clone()];
        let mut entries =
            lookup_dictionary_terms(&connection, target_language, &detected, &exact_terms, 12)?;
        let mut personal_entries =
            lookup_personal_terms(&connection, target_language, &detected, &exact_terms, 12)?;
        let mut segmented = false;

        if should_merge_inflection_candidates(&normalized, context, &detected) {
            let inflection_terms = inflection_lookup_terms(&normalized, &detected);
            if !inflection_terms.is_empty() {
                let mut inflected_entries = lookup_dictionary_terms(
                    &connection,
                    target_language,
                    &detected,
                    &inflection_terms,
                    12,
                )?;
                let mut known_entry_ids = inflected_entries
                    .iter()
                    .map(|entry| entry.entry_id)
                    .collect::<HashSet<_>>();
                inflected_entries.extend(
                    entries
                        .drain(..)
                        .filter(|entry| known_entry_ids.insert(entry.entry_id)),
                );
                entries = inflected_entries;
            }
        }

        if entries.is_empty() && personal_entries.is_empty() {
            let inflection_terms = inflection_lookup_terms(&normalized, &detected);
            if !inflection_terms.is_empty() {
                entries = lookup_dictionary_terms(
                    &connection,
                    target_language,
                    &detected,
                    &inflection_terms,
                    12,
                )?;
                personal_entries = lookup_personal_terms(
                    &connection,
                    target_language,
                    &detected,
                    &inflection_terms,
                    4,
                )?;
            }
        }

        if entries.is_empty() && personal_entries.is_empty() {
            let terms = segment_lookup_terms(&connection, &normalized, &detected, target_language)?;
            if !terms.is_empty() {
                entries =
                    lookup_dictionary_terms(&connection, target_language, &detected, &terms, 12)?;
                personal_entries =
                    lookup_personal_terms(&connection, target_language, &detected, &terms, 4)?;
                segmented = !(entries.is_empty() && personal_entries.is_empty());
            }
        }
        rank_entries_for_context(&mut entries, context);

        Ok(DictionaryLookupResult {
            query,
            source_language: detected,
            target_language: target_language.to_string(),
            selection_translation: String::new(),
            localization_pending: false,
            segmented,
            entries,
            personal_entries,
        })
    }

    pub fn cache_localized_result(&self, result: &DictionaryLookupResult) -> Result<(), String> {
        if !is_supported_language_code(&result.target_language) {
            return Err("사전 뜻의 대상 언어가 올바르지 않습니다.".to_string());
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("사전 뜻 캐시 저장을 시작하지 못했습니다: {error}"))?;
        for entry in result
            .entries
            .iter()
            .filter(|entry| entry.entry_id > 0 && entry.definition_origin == "automatic")
        {
            transaction
                .execute(
                    "INSERT INTO dictionary_localized_text \
                     (entry_id, locale, source_locale, text, quality_version, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                     ON CONFLICT(entry_id, locale) DO UPDATE SET \
                       source_locale=excluded.source_locale, text=excluded.text, \
                       quality_version=excluded.quality_version, updated_at=excluded.updated_at",
                    params![
                        entry.entry_id,
                        result.target_language,
                        entry.original_definition_language,
                        entry.definition,
                        LOCALIZED_TEXT_QUALITY_VERSION,
                        now_seconds()
                    ],
                )
                .map_err(|error| format!("자동 번역한 사전 뜻을 저장하지 못했습니다: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("자동 번역한 사전 뜻 저장을 완료하지 못했습니다: {error}"))
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
        self.install_bundled_pack_with_progress(language, |_, _| {})
    }

    pub fn install_bundled_pack_with_progress<F>(
        &self,
        language: &str,
        progress: F,
    ) -> Result<DictionaryPackStatus, String>
    where
        F: FnMut(u64, u64),
    {
        if !is_supported_language_code(language) {
            return Err("설치할 사전팩의 언어가 올바르지 않습니다.".to_string());
        }
        let catalog = practical_catalog(language)?;
        let pack = catalog
            .packs
            .iter()
            .find(|pack| pack.language == language)
            .ok_or_else(|| "이 언어의 확장 사전은 아직 준비되지 않았습니다.".to_string())?;
        self.install_pack_with_progress(pack, progress)?;
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
        connection
            .execute_batch("VACUUM")
            .map_err(|error| format!("삭제한 사전팩 공간을 정리하지 못했습니다: {error}"))?;
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
        let catalog = pack_catalog()?;
        let mut result = Vec::with_capacity(LANGUAGE_MENU_ORDER.len());
        for language in LANGUAGE_MENU_ORDER {
            let code = language.code();
            let offered = catalog.languages.iter().find(|pack| pack.code == code);
            let installed = self.pack_status(code)?.map(|mut pack| {
                if let Some(offered) = offered {
                    pack.availability.clone_from(&offered.availability);
                    pack.available_entry_count = offered.entry_count;
                    pack.compressed_bytes = offered.compressed_bytes;
                    pack.sha256.clone_from(&offered.sha256);
                }
                pack
            });
            result.push(installed.unwrap_or_else(|| {
                DictionaryPackStatus {
                    id: format!("nudenyang-{code}-practical"),
                    language: code.to_string(),
                    language_name: language.english_name().to_string(),
                    version: offered.map(|pack| pack.version.clone()).unwrap_or_default(),
                    title: offered
                        .filter(|pack| !pack.title.is_empty())
                        .map(|pack| pack.title.clone())
                        .unwrap_or_else(|| format!("{} dictionary pack", language.english_name())),
                    availability: offered
                        .map(|pack| pack.availability.clone())
                        .unwrap_or_else(|| "planned".to_string()),
                    edition: "none".to_string(),
                    installed: false,
                    entry_count: 0,
                    available_entry_count: offered.map(|pack| pack.entry_count).unwrap_or(0),
                    compressed_bytes: offered.map(|pack| pack.compressed_bytes).unwrap_or(0),
                    sha256: offered.map(|pack| pack.sha256.clone()).unwrap_or_default(),
                    source_name: offered.map(|pack| pack.source.clone()).unwrap_or_default(),
                    license: offered
                        .map(|pack| pack.license.clone())
                        .unwrap_or_else(|| "CC BY-SA / GFDL source review required".to_string()),
                    source_url: offered
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
                "SELECT id, language, version, title, entry_count, license, source_url, edition, source_name \
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
                        edition: row.get(7)?,
                        installed: true,
                        entry_count: row.get(4)?,
                        available_entry_count: row.get(4)?,
                        compressed_bytes: 0,
                        sha256: String::new(),
                        source_name: row.get(8)?,
                        license: row.get(5)?,
                        source_url: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("사전팩 상태를 확인하지 못했습니다: {error}"))
    }

    fn install_starter_pack_if_available(&self, language: &str) -> Result<(), String> {
        if let Some(installed) = self.pack_status(language)? {
            if installed.edition == "practical" {
                let offered = pack_catalog()?
                    .languages
                    .into_iter()
                    .find(|pack| pack.code == language && pack.availability == "practical");
                if offered.is_some_and(|pack| {
                    !pack.version.is_empty() && pack.version != installed.version
                }) {
                    let catalog = practical_catalog(language)?;
                    if let Some(pack) = catalog.packs.iter().find(|pack| pack.language == language)
                    {
                        self.install_pack(pack)?;
                    }
                }
            }
            return Ok(());
        }
        let catalog = starter_catalog()?;
        if let Some(pack) = catalog.packs.iter().find(|pack| pack.language == language) {
            self.install_pack(pack)?;
        }
        Ok(())
    }

    fn install_pack(&self, pack: &StarterPack) -> Result<(), String> {
        self.install_pack_with_progress(pack, |_, _| {})
    }

    fn install_pack_with_progress<F>(
        &self,
        pack: &StarterPack,
        mut progress: F,
    ) -> Result<(), String>
    where
        F: FnMut(u64, u64),
    {
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
                "INSERT INTO dictionary_packs (id, language, version, title, source_name, source_url, license, edition, entry_count, installed_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![pack.id, pack.language, pack.version, pack.title, pack.source_name,
                    pack.source_url, pack.license, pack.edition, pack.entries.len() as u64, now_seconds()],
            )
            .map_err(|error| format!("사전팩 정보를 저장하지 못했습니다: {error}"))?;
        let total = pack.entries.len() as u64;
        progress(0, total);
        for (index, entry) in pack.entries.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO dictionary_entries (pack_id, language, headword, normalized_headword, reading, part_of_speech, sense_rank) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![pack.id, pack.language, entry.headword, normalize_term(&entry.headword), entry.reading, entry.part_of_speech, entry.sense_rank],
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
            let processed = index as u64 + 1;
            if processed == total || processed.is_multiple_of(500) {
                progress(processed, total);
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("사전팩 설치를 완료하지 못했습니다: {error}"))
    }
}

#[derive(Clone, Debug)]
struct LookupSpan {
    term: String,
    start: usize,
    end: usize,
}

fn lookup_dictionary_terms(
    connection: &Connection,
    target_language: &str,
    detected_language: &str,
    terms: &[String],
    per_term_limit: usize,
) -> Result<Vec<DictionaryEntry>, String> {
    let mut statement = connection
        .prepare(
            "SELECT e.id, e.headword, e.language, e.reading, e.part_of_speech, \
                    COALESCE(g_target.text, g_cached.text, g_en.text, g_any.text, ''), \
                    CASE WHEN g_target.text IS NOT NULL THEN ?1 \
                         WHEN g_cached.text IS NOT NULL THEN ?1 \
                         WHEN g_en.text IS NOT NULL THEN 'en' \
                         ELSE COALESCE(g_any.locale, '') END, \
                    CASE WHEN g_target.text IS NOT NULL THEN 'native' \
                         WHEN g_cached.text IS NOT NULL THEN 'automatic' \
                         ELSE 'original' END, \
                    COALESCE(g_en.text, g_any.text, ''), \
                    CASE WHEN g_en.text IS NOT NULL THEN 'en' ELSE COALESCE(g_any.locale, '') END, \
                    COALESCE(x_target.text, x_en.text, x_any.text, ''), \
                    p.source_name, p.source_url, p.license, e.sense_rank \
             FROM dictionary_entries e \
             JOIN dictionary_packs p ON p.id=e.pack_id \
             LEFT JOIN dictionary_text g_target ON g_target.entry_id=e.id AND g_target.kind='gloss' AND g_target.locale=?1 \
             LEFT JOIN dictionary_localized_text g_cached ON g_cached.entry_id=e.id AND g_cached.locale=?1 AND g_cached.quality_version=?5 \
             LEFT JOIN dictionary_text g_en ON g_en.entry_id=e.id AND g_en.kind='gloss' AND g_en.locale='en' \
             LEFT JOIN dictionary_text g_any ON g_any.id=(SELECT id FROM dictionary_text WHERE entry_id=e.id AND kind='gloss' ORDER BY locale LIMIT 1) \
             LEFT JOIN dictionary_text x_target ON x_target.entry_id=e.id AND x_target.kind='example' AND x_target.locale=?1 \
             LEFT JOIN dictionary_text x_en ON x_en.entry_id=e.id AND x_en.kind='example' AND x_en.locale='en' \
             LEFT JOIN dictionary_text x_any ON x_any.id=(SELECT id FROM dictionary_text WHERE entry_id=e.id AND kind='example' ORDER BY locale LIMIT 1) \
             WHERE e.normalized_headword=?2 AND (?3='' OR e.language=?3) \
             ORDER BY CASE WHEN e.language=?3 THEN 0 ELSE 1 END, e.sense_rank, e.id LIMIT ?4",
        )
        .map_err(|error| format!("사전 조회를 준비하지 못했습니다: {error}"))?;
    let total_limit = per_term_limit.saturating_mul(terms.len()).min(96);
    let mut entries = Vec::new();
    for term in terms {
        let rows = statement
            .query_map(
                params![
                    target_language,
                    term,
                    detected_language,
                    per_term_limit as i64,
                    LOCALIZED_TEXT_QUALITY_VERSION
                ],
                dictionary_from_row,
            )
            .map_err(|error| format!("사전을 조회하지 못했습니다: {error}"))?;
        for row in rows {
            entries.push(row.map_err(|error| format!("사전 항목을 읽지 못했습니다: {error}"))?);
            if entries.len() >= total_limit {
                return Ok(entries);
            }
        }
    }
    Ok(entries)
}

fn lookup_personal_terms(
    connection: &Connection,
    target_language: &str,
    detected_language: &str,
    terms: &[String],
    per_term_limit: usize,
) -> Result<Vec<PersonalDictionaryEntry>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, source_language, target_language, source_term, target_term, note, \
                    scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
             FROM personal_dictionary \
             WHERE normalized_source_term=?1 AND (?2='' OR source_language=?2) \
               AND (target_language=?3 OR target_language='*') \
             ORDER BY updated_at DESC LIMIT ?4",
        )
        .map_err(|error| format!("개인 사전 조회를 준비하지 못했습니다: {error}"))?;
    let total_limit = per_term_limit.saturating_mul(terms.len()).min(16);
    let mut entries = Vec::new();
    for term in terms {
        let rows = statement
            .query_map(
                params![
                    term,
                    detected_language,
                    target_language,
                    per_term_limit as i64
                ],
                personal_from_row,
            )
            .map_err(|error| format!("개인 사전을 조회하지 못했습니다: {error}"))?;
        for row in rows {
            entries
                .push(row.map_err(|error| format!("개인 사전 항목을 읽지 못했습니다: {error}"))?);
            if entries.len() >= total_limit {
                return Ok(entries);
            }
        }
    }
    Ok(entries)
}

fn inflection_lookup_terms(normalized_term: &str, detected_language: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut known = HashSet::new();
    match detected_language {
        "ja" => japanese_inflection_terms(normalized_term, &mut terms, &mut known),
        "ko" => korean_inflection_terms(normalized_term, &mut terms, &mut known),
        "en" => english_inflection_terms(normalized_term, &mut terms, &mut known),
        _ => {}
    }
    terms
}

fn should_merge_inflection_candidates(
    normalized_term: &str,
    context: &str,
    detected_language: &str,
) -> bool {
    if normalized_term.is_empty() {
        return false;
    }
    if detected_language == "en" {
        return true;
    }
    if detected_language != "ja" || context.is_empty() {
        return false;
    }
    let normalized_context = normalize_term(context);
    normalized_context
        .match_indices(normalized_term)
        .map(|(start, _)| &normalized_context[start + normalized_term.len()..])
        .any(|tail| {
            [
                "つつ",
                "ながら",
                "ます",
                "ました",
                "ません",
                "たい",
                "たがる",
                "て",
                "で",
                "た",
                "たり",
                "そう",
                "やすい",
                "にくい",
                "始める",
                "続ける",
                "終わる",
            ]
            .iter()
            .any(|suffix| tail.starts_with(suffix))
        })
}

fn push_inflection_term(
    original: &str,
    candidate: String,
    terms: &mut Vec<String>,
    known: &mut HashSet<String>,
) {
    let candidate = normalize_term(&candidate);
    if candidate.chars().count() >= 2 && candidate != original && known.insert(candidate.clone()) {
        terms.push(candidate);
    }
}

fn replace_last_character(value: &str, replacement: char) -> Option<String> {
    let mut characters = value.chars().collect::<Vec<_>>();
    characters.pop()?;
    characters.push(replacement);
    Some(characters.into_iter().collect())
}

fn japanese_godan_i_stem(value: &str) -> Option<String> {
    let replacement = match value.chars().last()? {
        'い' => 'う',
        'き' => 'く',
        'ぎ' => 'ぐ',
        'し' => 'す',
        'ち' => 'つ',
        'に' => 'ぬ',
        'び' => 'ぶ',
        'み' => 'む',
        'り' => 'る',
        _ => return None,
    };
    replace_last_character(value, replacement)
}

fn japanese_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);

    if let Some(candidate) = japanese_godan_i_stem(term) {
        push(candidate);
    }

    for suffix in ["ませんでした", "ました", "ません", "ます"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}る"));
            if let Some(candidate) = japanese_godan_i_stem(stem) {
                push(candidate);
            }
        }
    }

    for (suffix, endings) in [
        ("って", &['う', 'つ', 'る'][..]),
        ("った", &['う', 'つ', 'る'][..]),
        ("いて", &['く'][..]),
        ("いた", &['く'][..]),
        ("いで", &['ぐ'][..]),
        ("いだ", &['ぐ'][..]),
        ("んで", &['ぬ', 'ぶ', 'む'][..]),
        ("んだ", &['ぬ', 'ぶ', 'む'][..]),
        ("して", &['す'][..]),
        ("した", &['す'][..]),
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            for ending in endings {
                push(format!("{stem}{ending}"));
            }
            if matches!(suffix, "して" | "した") {
                push(format!("{stem}する"));
            }
        }
    }

    for suffix in ["なかった", "ない", "て", "た"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}る"));
        }
    }

    for (suffix, ending) in [
        ("わない", 'う'),
        ("かない", 'く'),
        ("がない", 'ぐ'),
        ("さない", 'す'),
        ("たない", 'つ'),
        ("なない", 'ぬ'),
        ("ばない", 'ぶ'),
        ("まない", 'む'),
        ("らない", 'る'),
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}{ending}"));
        }
    }

    for suffix in ["くなかった", "くない", "かった", "ければ", "く"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}い"));
        }
    }

    for (surface, base) in [
        ("した", "する"),
        ("して", "する"),
        ("します", "する"),
        ("しました", "する"),
        ("しない", "する"),
        ("来た", "来る"),
        ("来て", "来る"),
    ] {
        if term == surface {
            push(base.to_string());
        }
    }
}

fn korean_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);

    for (surface, base) in [
        ("했어요", "하다"),
        ("했다", "하다"),
        ("했었어", "하다"),
        ("했었어요", "하다"),
        ("해요", "하다"),
        ("합니다", "하다"),
        ("했습니다", "하다"),
        ("됐어요", "되다"),
        ("됐다", "되다"),
        ("였어", "이다"),
        ("였었어", "이다"),
        ("그런", "그렇다"),
        ("이런", "이렇다"),
        ("저런", "저렇다"),
        ("같애", "같다"),
        ("같애요", "같다"),
    ] {
        if term == surface {
            push(base.to_string());
        }
    }

    for suffix in [
        "었습니다",
        "았습니다",
        "었었어요",
        "았었어요",
        "었었어",
        "았었어",
        "습니까",
        "습니다",
        "었어요",
        "았어요",
        "었어",
        "았어",
        "어요",
        "아요",
        "는다",
        "었다",
        "았다",
        "고",
        "며",
        "면",
        "자",
        "지",
    ] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(format!("{stem}다"));
        }
    }

    if let Some(stem) = term.strip_suffix('요') {
        push(format!("{stem}다"));
    }

    for particle in [
        "으로", "에서", "에게", "한테", "까지", "부터", "처럼", "보다", "께서", "은", "는", "이",
        "가", "을", "를", "의", "에", "도", "와", "과", "로", "만", "께",
    ] {
        if let Some(stem) = term.strip_suffix(particle) {
            push(stem.to_string());
        }
    }
}

fn english_inflection_terms(term: &str, terms: &mut Vec<String>, known: &mut HashSet<String>) {
    let mut push = |candidate: String| push_inflection_term(term, candidate, terms, known);

    if let Some(base) = [
        ("went", "go"),
        ("gone", "go"),
        ("was", "be"),
        ("were", "be"),
        ("been", "be"),
        ("did", "do"),
        ("done", "do"),
        ("had", "have"),
        ("made", "make"),
        ("took", "take"),
        ("taken", "take"),
        ("came", "come"),
        ("saw", "see"),
        ("seen", "see"),
    ]
    .iter()
    .find_map(|(surface, base)| (*surface == term).then_some(*base))
    {
        push(base.to_string());
    }

    if let Some(stem) = term.strip_suffix("ies") {
        push(format!("{stem}y"));
    }
    if let Some(stem) = term.strip_suffix('s') {
        push(stem.to_string());
    }
    if let Some(stem) = term.strip_suffix("es") {
        push(stem.to_string());
        push(format!("{stem}e"));
    }

    for suffix in ["ing", "ed"] {
        if let Some(stem) = term.strip_suffix(suffix) {
            push(stem.to_string());
            push(format!("{stem}e"));
            let characters = stem.chars().collect::<Vec<_>>();
            if characters.len() >= 2
                && characters[characters.len() - 1] == characters[characters.len() - 2]
            {
                push(characters[..characters.len() - 1].iter().collect());
            }
        }
    }
}

fn segment_lookup_terms(
    connection: &Connection,
    normalized_query: &str,
    detected_language: &str,
    target_language: &str,
) -> Result<Vec<String>, String> {
    let segmentation_query = normalize_segmentation_query(normalized_query, detected_language);
    let spans = lookup_spans(&segmentation_query, detected_language);
    if spans.is_empty() {
        return Ok(Vec::new());
    }
    let query_chars = segmentation_query.chars().collect::<Vec<_>>();
    let spans = spans
        .into_iter()
        .filter(|span| segmentation_candidate_is_plausible(&query_chars, detected_language, span))
        .collect::<Vec<_>>();
    if spans.is_empty() {
        return Ok(Vec::new());
    }

    let mut dictionary_exists = connection
        .prepare(
            "SELECT 1 FROM dictionary_entries \
             WHERE normalized_headword=?1 AND (?2='' OR language=?2) LIMIT 1",
        )
        .map_err(|error| format!("사전 표현 분해를 준비하지 못했습니다: {error}"))?;
    let mut personal_exists = connection
        .prepare(
            "SELECT 1 FROM personal_dictionary \
             WHERE normalized_source_term=?1 AND (?2='' OR source_language=?2) \
               AND (target_language=?3 OR target_language='*') LIMIT 1",
        )
        .map_err(|error| format!("개인 사전 표현 분해를 준비하지 못했습니다: {error}"))?;
    let mut availability = HashMap::new();
    let mut matched = Vec::new();
    for span in &spans {
        let inflection_candidates = inflection_lookup_terms(&span.term, detected_language);
        let candidates = if prefer_korean_base_form(&span.term, detected_language) {
            let mut candidates = inflection_candidates;
            candidates.push(span.term.clone());
            candidates
        } else {
            let mut candidates = vec![span.term.clone()];
            candidates.extend(inflection_candidates);
            candidates
        };
        for candidate in candidates {
            if candidate != span.term
                && !segmented_inflection_candidate_is_plausible(
                    &query_chars,
                    detected_language,
                    span,
                )
            {
                continue;
            }
            let available = if let Some(available) = availability.get(&candidate) {
                *available
            } else {
                let in_dictionary = dictionary_exists
                    .query_row(params![candidate, detected_language], |_| Ok(()))
                    .optional()
                    .map_err(|error| format!("사전 표현을 확인하지 못했습니다: {error}"))?
                    .is_some();
                let in_personal = if in_dictionary {
                    false
                } else {
                    personal_exists
                        .query_row(
                            params![candidate, detected_language, target_language],
                            |_| Ok(()),
                        )
                        .optional()
                        .map_err(|error| format!("개인 사전 표현을 확인하지 못했습니다: {error}"))?
                        .is_some()
                };
                let available = in_dictionary || in_personal;
                availability.insert(candidate.clone(), available);
                available
            };
            if available {
                matched.push(LookupSpan {
                    term: candidate,
                    start: span.start,
                    end: span.end,
                });
                break;
            }
        }
    }

    matched.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| (right.end - right.start).cmp(&(left.end - left.start)))
    });

    let mut cursor = 0;
    let mut terms = Vec::new();
    let mut returned = HashSet::new();
    while terms.len() < 8 {
        let Some(next_start) = matched
            .iter()
            .filter(|span| span.start >= cursor)
            .map(|span| span.start)
            .min()
        else {
            break;
        };
        let Some(best) = matched
            .iter()
            .filter(|span| span.start == next_start)
            .max_by_key(|span| span.end - span.start)
        else {
            break;
        };
        cursor = best.end;
        if returned.insert(best.term.clone()) {
            terms.push(best.term.clone());
        }
    }
    Ok(terms)
}

fn normalize_segmentation_query(normalized_query: &str, detected_language: &str) -> String {
    if detected_language != "ko" {
        return normalized_query.to_string();
    }
    normalized_query
        .replace("거같", "거 같")
        .replace("것같", "것 같")
}

fn prefer_korean_base_form(term: &str, detected_language: &str) -> bool {
    detected_language == "ko" && matches!(term, "그런" | "이런" | "저런")
}

fn segmented_inflection_candidate_is_plausible(
    query_chars: &[char],
    detected_language: &str,
    span: &LookupSpan,
) -> bool {
    if detected_language != "ko" || span.start == 0 {
        return true;
    }
    query_chars
        .get(span.start - 1)
        .is_none_or(|character| !character.is_alphanumeric())
}

fn segmentation_candidate_is_plausible(
    query_chars: &[char],
    detected_language: &str,
    span: &LookupSpan,
) -> bool {
    match detected_language {
        "ko" => !is_attached_korean_grammar_homograph(query_chars, span),
        _ => true,
    }
}

fn is_attached_korean_grammar_homograph(query_chars: &[char], span: &LookupSpan) -> bool {
    if span.term != "거지" || span.start == 0 || span.end > query_chars.len() {
        return false;
    }

    let previous = query_chars[span.start - 1];
    previous == '는'
        || matches!(previous, '이' | '그' | '저')
        || korean_syllable_ends_in_n_or_l(previous)
}

fn korean_syllable_ends_in_n_or_l(character: char) -> bool {
    let codepoint = character as u32;
    if !(0xAC00..=0xD7A3).contains(&codepoint) {
        return false;
    }
    matches!((codepoint - 0xAC00) % 28, 4 | 8)
}

fn lookup_spans(normalized_query: &str, detected_language: &str) -> Vec<LookupSpan> {
    let chars = normalized_query.chars().collect::<Vec<_>>();
    let compact = matches!(detected_language, "ja" | "ko" | "th" | "zh" | "zh-Hant")
        || chars.iter().copied().any(is_compact_dictionary_character);
    let mut spans = Vec::new();
    for start in 0..chars.len() {
        if !chars[start].is_alphanumeric()
            || (!compact && start > 0 && chars[start - 1].is_alphanumeric())
        {
            continue;
        }
        let max_end = (start + 24).min(chars.len());
        for end in (start + 2)..=max_end {
            if !chars[end - 1].is_alphanumeric()
                || (!compact && end < chars.len() && chars[end].is_alphanumeric())
            {
                continue;
            }
            spans.push(LookupSpan {
                term: chars[start..end].iter().collect(),
                start,
                end,
            });
        }
    }
    spans
}

fn is_compact_dictionary_character(character: char) -> bool {
    matches!(
        character as u32,
        0x0E00..=0x0E7F
            | 0x3040..=0x30FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2FA1F
    )
}

fn dictionary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictionaryEntry> {
    Ok(DictionaryEntry {
        entry_id: row.get(0)?,
        headword: row.get(1)?,
        language: row.get(2)?,
        reading: row.get(3)?,
        part_of_speech: row.get(4)?,
        sense_rank: row.get(14)?,
        context_recommended: false,
        definition: row.get(5)?,
        definition_language: row.get(6)?,
        definition_origin: row.get(7)?,
        original_definition: row.get(8)?,
        original_definition_language: row.get(9)?,
        example: row.get(10)?,
        source_name: row.get(11)?,
        source_url: row.get(12)?,
        license: row.get(13)?,
    })
}

fn rank_entries_for_context(entries: &mut Vec<DictionaryEntry>, context: &str) {
    let normalized_context = normalize_term(context);
    let context_language = detect_language(&normalized_context).language;
    let mut groups: Vec<Vec<DictionaryEntry>> = Vec::new();
    for mut entry in entries.drain(..) {
        entry.context_recommended = false;
        let key = (entry.language.as_str(), normalize_term(&entry.headword));
        if let Some(group) = groups.iter_mut().find(|group| {
            group.first().is_some_and(|first| {
                first.language == key.0 && normalize_term(&first.headword) == key.1
            })
        }) {
            group.push(entry);
        } else {
            groups.push(vec![entry]);
        }
    }
    for group in &mut groups {
        group.sort_by(|left, right| {
            contextual_sense_score(right, &normalized_context, context_language)
                .ranking
                .cmp(&contextual_sense_score(left, &normalized_context, context_language).ranking)
                .then_with(|| left.sense_rank.cmp(&right.sense_rank))
                .then_with(|| left.entry_id.cmp(&right.entry_id))
        });
        if group.len() > 1 {
            let first = contextual_sense_score(&group[0], &normalized_context, context_language);
            let second = contextual_sense_score(&group[1], &normalized_context, context_language);
            if first.evidence >= 24 && first.ranking.saturating_sub(second.ranking) >= 12 {
                group[0].context_recommended = true;
            }
        }
    }
    entries.extend(groups.into_iter().flatten());
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ContextualSenseScore {
    ranking: i32,
    evidence: i32,
}

fn contextual_sense_score(
    entry: &DictionaryEntry,
    context: &str,
    context_language: Language,
) -> ContextualSenseScore {
    let displayed_language =
        Language::try_from(entry.definition_language.as_str()).unwrap_or(Language::Unknown);
    let (definition, definition_language) =
        if displayed_language == context_language && !entry.definition.is_empty() {
            (entry.definition.as_str(), displayed_language)
        } else if entry.original_definition.is_empty() {
            (entry.definition.as_str(), displayed_language)
        } else {
            let original_language = Language::try_from(entry.original_definition_language.as_str())
                .unwrap_or(Language::Unknown);
            (entry.original_definition.as_str(), original_language)
        };
    let normalized_definition = normalize_term(definition);
    let comparable_language = context_language != Language::Unknown
        && definition_language != Language::Unknown
        && context_language == definition_language;
    let mut score = ContextualSenseScore::default();
    if comparable_language {
        for token in normalized_definition
            .split(|character: char| !character.is_alphanumeric())
            .filter(|token| contextual_token_is_informative(token, definition_language))
        {
            if context.contains(token) {
                score.ranking += 12;
                score.evidence += 12;
            }
        }
    }
    let historical = [
        "(역사)",
        "역사적",
        "historical",
        "history",
        "歴史",
        "历史",
        "歷史",
    ]
    .iter()
    .any(|marker| normalized_definition.contains(marker));
    let dated = [
        "(고어)", "옛말", "폐어", "archaic", "obsolete", "dated", "古語", "古语", "廢語", "废语",
    ]
    .iter()
    .any(|marker| normalized_definition.contains(marker));
    if historical {
        let historical_context = [
            "역사", "왕", "왕조", "궁궐", "조선", "신하", "histor", "dynasty", "court", "歴史",
            "王朝", "宮廷", "历史", "歷史", "王朝", "宫廷",
        ]
        .iter()
        .any(|cue| context.contains(cue));
        if historical_context {
            score.ranking += 24;
            score.evidence += 24;
        } else {
            score.ranking -= 80;
        }
    }
    if dated {
        let dated_context = [
            "고어", "옛말", "어원", "archaic", "obsolete", "古語", "古语",
        ]
        .iter()
        .any(|cue| context.contains(cue));
        if dated_context {
            score.ranking += 24;
            score.evidence += 24;
        } else {
            score.ranking -= 60;
        }
    }
    let figurative = [
        "(비유)",
        "비유적으로",
        "figurative",
        "metaphorical",
        "比喩",
        "比喻",
    ]
    .iter()
    .any(|marker| normalized_definition.contains(marker));
    if figurative {
        let figurative_context = [
            "비유",
            "은유",
            "상징",
            "마치",
            "처럼",
            "figurative",
            "metaphor",
            "symbol",
            "比喩",
            "比喻",
            "象徴",
            "象征",
        ]
        .iter()
        .any(|cue| context.contains(cue));
        if figurative_context {
            score.ranking += 24;
            score.evidence += 24;
        } else {
            score.ranking -= 40;
        }
    }
    score
}

fn contextual_token_is_informative(token: &str, language: Language) -> bool {
    if token.chars().count() < 2 {
        return false;
    }
    let common = match language {
        Language::Korean => [
            "있다",
            "하다",
            "되다",
            "것",
            "것이",
            "것을",
            "말",
            "사람",
            "무엇",
            "어떤",
            "또는",
            "따위",
            "이르다",
        ]
        .as_slice(),
        Language::English => [
            "the", "and", "that", "this", "with", "from", "into", "person", "thing", "be", "is",
            "are", "or",
        ]
        .as_slice(),
        _ => &[],
    };
    !common.contains(&token)
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

fn pack_catalog() -> Result<PackCatalog, String> {
    let catalog: PackCatalog = serde_json::from_str(PACK_CATALOG_JSON)
        .map_err(|error| format!("사전팩 카탈로그를 읽지 못했습니다: {error}"))?;
    if catalog.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(format!(
            "지원하지 않는 사전팩 카탈로그 형식입니다: {}",
            catalog.schema_version
        ));
    }
    Ok(catalog)
}

fn practical_pack_bytes(language: &str) -> Option<&'static [u8]> {
    match language {
        "en" => Some(PRACTICAL_EN_GZIP),
        "ja" => Some(PRACTICAL_JA_GZIP),
        "ko" => Some(PRACTICAL_KO_GZIP),
        "zh" => Some(PRACTICAL_ZH_GZIP),
        "zh-Hant" => Some(PRACTICAL_ZH_HANT_GZIP),
        _ => None,
    }
}

fn practical_catalog(language: &str) -> Result<StarterCatalog, String> {
    let bytes = practical_pack_bytes(language)
        .ok_or_else(|| "이 언어의 확장 사전은 아직 준비되지 않았습니다.".to_string())?;
    let manifest = pack_catalog()?;
    let offered = manifest
        .languages
        .iter()
        .find(|pack| pack.code == language && pack.availability == "practical")
        .ok_or_else(|| "사전팩 배포 정보를 찾지 못했습니다.".to_string())?;
    if bytes.len() as u64 != offered.compressed_bytes {
        return Err(format!(
            "사전팩 압축 크기가 일치하지 않습니다({}/{} bytes).",
            bytes.len(),
            offered.compressed_bytes
        ));
    }
    let digest = format!("{:x}", Sha256::digest(bytes));
    if !digest.eq_ignore_ascii_case(&offered.sha256) {
        return Err("사전팩 무결성 확인에 실패했습니다.".to_string());
    }
    let mut decoder = GzDecoder::new(bytes);
    let mut json = Vec::new();
    decoder
        .read_to_end(&mut json)
        .map_err(|error| format!("사전팩 압축을 풀지 못했습니다: {error}"))?;
    let catalog: StarterCatalog = serde_json::from_slice(&json)
        .map_err(|error| format!("확장 사전을 읽지 못했습니다: {error}"))?;
    if catalog.schema_version != PACK_SCHEMA_VERSION {
        return Err(format!(
            "지원하지 않는 확장 사전 형식입니다: {}",
            catalog.schema_version
        ));
    }
    let pack = catalog
        .packs
        .iter()
        .find(|pack| pack.language == language)
        .ok_or_else(|| "확장 사전의 언어 정보가 올바르지 않습니다.".to_string())?;
    if pack.edition != "practical" || pack.entries.len() as u64 != offered.entry_count {
        return Err("확장 사전의 항목 수 또는 등급 정보가 올바르지 않습니다.".to_string());
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
           edition TEXT NOT NULL DEFAULT 'mini', entry_count INTEGER NOT NULL, installed_at REAL NOT NULL); \
         CREATE TABLE IF NOT EXISTS dictionary_entries ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL REFERENCES dictionary_packs(id) ON DELETE CASCADE, \
           language TEXT NOT NULL, headword TEXT NOT NULL, normalized_headword TEXT NOT NULL, \
           reading TEXT NOT NULL DEFAULT '', part_of_speech TEXT NOT NULL DEFAULT 'other', \
           sense_rank INTEGER NOT NULL DEFAULT 0); \
         CREATE INDEX IF NOT EXISTS idx_dictionary_lookup ON dictionary_entries(normalized_headword, language); \
         CREATE TABLE IF NOT EXISTS dictionary_text ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE, \
           kind TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(entry_id, kind, locale)); \
         CREATE TABLE IF NOT EXISTS dictionary_localized_text ( \
           entry_id INTEGER NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE, \
           locale TEXT NOT NULL, source_locale TEXT NOT NULL, text TEXT NOT NULL, \
           quality_version INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL, \
           PRIMARY KEY(entry_id, locale)); \
         CREATE TABLE IF NOT EXISTS personal_dictionary ( \
           id INTEGER PRIMARY KEY AUTOINCREMENT, source_language TEXT NOT NULL, target_language TEXT NOT NULL, \
           source_term TEXT NOT NULL, normalized_source_term TEXT NOT NULL, target_term TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', \
           scope TEXT NOT NULL DEFAULT 'global', scope_value TEXT NOT NULL DEFAULT '', case_sensitive INTEGER NOT NULL DEFAULT 0, \
           whole_word INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, updated_at REAL NOT NULL, \
           UNIQUE(source_language, target_language, normalized_source_term, scope, scope_value)); \
         CREATE INDEX IF NOT EXISTS idx_personal_dictionary_lookup \
           ON personal_dictionary(normalized_source_term, source_language, target_language);"
    ).map_err(|error| format!("사전 저장소 테이블을 만들지 못했습니다: {error}"))?;
    let has_edition = connection
        .prepare("PRAGMA table_info(dictionary_packs)")
        .and_then(|mut statement| {
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(columns.iter().any(|column| column == "edition"))
        })
        .map_err(|error| format!("사전팩 저장소 형식을 확인하지 못했습니다: {error}"))?;
    if !has_edition {
        connection
            .execute(
                "ALTER TABLE dictionary_packs ADD COLUMN edition TEXT NOT NULL DEFAULT 'mini'",
                [],
            )
            .map_err(|error| format!("사전팩 저장소 형식을 갱신하지 못했습니다: {error}"))?;
    }
    let has_sense_rank = connection
        .prepare("PRAGMA table_info(dictionary_entries)")
        .and_then(|mut statement| {
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(columns.iter().any(|column| column == "sense_rank"))
        })
        .map_err(|error| format!("사전 항목 저장소 형식을 확인하지 못했습니다: {error}"))?;
    if !has_sense_rank {
        connection
            .execute(
                "ALTER TABLE dictionary_entries ADD COLUMN sense_rank INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("사전 항목 저장소 형식을 갱신하지 못했습니다: {error}"))?;
    }
    let has_localized_quality_version = connection
        .prepare("PRAGMA table_info(dictionary_localized_text)")
        .and_then(|mut statement| {
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(columns.iter().any(|column| column == "quality_version"))
        })
        .map_err(|error| format!("자동 번역 사전 뜻의 저장 형식을 확인하지 못했습니다: {error}"))?;
    if !has_localized_quality_version {
        connection
            .execute(
                "ALTER TABLE dictionary_localized_text ADD COLUMN quality_version INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("자동 번역 사전 뜻의 저장 형식을 갱신하지 못했습니다: {error}"))?;
    }
    Ok(())
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
fn default_mini_edition() -> String {
    "mini".to_string()
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
    use std::collections::HashMap;

    use super::{
        lookup_spans, segmentation_candidate_is_plausible, DictionaryStore,
        PersonalDictionaryEntry, StarterEntry, StarterPack,
    };

    fn temporary_store(name: &str) -> DictionaryStore {
        let path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-{name}-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        DictionaryStore::open(path).unwrap()
    }

    fn test_sense(headword: &str, definition: &str, sense_rank: i64) -> StarterEntry {
        StarterEntry {
            headword: headword.to_string(),
            reading: "[t͡ɕʌ̹ŋɕʰin]".to_string(),
            part_of_speech: "noun".to_string(),
            sense_rank,
            glosses: HashMap::from([("ko".to_string(), definition.to_string())]),
            examples: HashMap::new(),
        }
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
        assert_eq!(result.entries[0].definition_language, "ko");
        assert_eq!(result.entries[0].definition_origin, "native");
        assert!(!result.segmented);
        assert!(!result.needs_localization());
        assert_eq!(store.status().unwrap().installed_pack_count, 1);
        let installed = store
            .pack_catalog()
            .unwrap()
            .into_iter()
            .find(|pack| pack.language == "en")
            .unwrap();
        assert!(installed.installed);
        assert_eq!(installed.availability, "practical");
        assert_eq!(installed.edition, "mini");

        let phrase = store.lookup("future server", Some("en"), "ko").unwrap();
        assert!(phrase.segmented);
        assert_eq!(
            phrase
                .entries
                .iter()
                .map(|entry| entry.headword.as_str())
                .collect::<Vec<_>>(),
            vec!["future", "server"]
        );
    }

    #[test]
    fn automatic_definition_overlay_preserves_and_reuses_the_original_gloss() {
        let store = temporary_store("localized-overlay");
        let mut result = store.lookup("future", Some("en"), "ja").unwrap();
        assert!(result.needs_localization());
        assert_eq!(result.entries[0].definition_language, "en");
        assert_eq!(result.entries[0].definition_origin, "original");
        assert_eq!(
            result.entries[0].original_definition,
            "The time or events that come after the present."
        );

        store
            .connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO dictionary_localized_text \
                 (entry_id, locale, source_locale, text, quality_version, updated_at) \
                 VALUES (?1, 'ja', 'en', '以前の無検査キャッシュ', 0, 0)",
                rusqlite::params![result.entries[0].entry_id],
            )
            .unwrap();
        let legacy = store.lookup("future", Some("en"), "ja").unwrap();
        assert_eq!(legacy.entries[0].definition_origin, "original");
        assert!(legacy.needs_localization());

        result.entries[0].definition = "現在より後の時間、またはこれから起こる出来事。".to_string();
        result.entries[0].definition_language = "ja".to_string();
        result.entries[0].definition_origin = "automatic".to_string();
        store.cache_localized_result(&result).unwrap();

        let cached = store.lookup("future", Some("en"), "ja").unwrap();
        assert_eq!(
            cached.entries[0].definition,
            "現在より後の時間、またはこれから起こる出来事。"
        );
        assert_eq!(cached.entries[0].definition_language, "ja");
        assert_eq!(cached.entries[0].definition_origin, "automatic");
        assert_eq!(cached.entries[0].original_definition_language, "en");
        assert!(!cached.needs_localization());
    }

    #[test]
    fn homonymous_senses_keep_the_source_order_until_context_evidence_is_strong() {
        let store = temporary_store("contextual-senses");
        store
            .install_pack(&StarterPack {
                id: "test-ko-contextual-senses".to_string(),
                language: "ko".to_string(),
                version: "2026.08.18.1".to_string(),
                title: "문맥 사전 테스트".to_string(),
                source_name: "Test".to_string(),
                source_url: "https://example.com".to_string(),
                license: "Test".to_string(),
                edition: "mini".to_string(),
                entries: vec![
                    test_sense(
                        "정신",
                        "사람의 느낌, 마음 따위를 아우러 이르는 말. 또는 생각하고 판단하는 능력. 또는 마음 자세나 상태.",
                        0,
                    ),
                    test_sense("정신", "어떤 일에 앞장서는 것.", 1),
                    test_sense("정신", "(역사) 궁궐 안에서 벼슬하는 신하.", 2),
                ],
            })
            .unwrap();

        let conversational = store
            .lookup_with_context(
                "조금씩 정신이 드는 중",
                "조금씩 정신이 드는 중",
                Some("ko"),
                "ko",
            )
            .unwrap();
        assert!(conversational.segmented);
        assert_eq!(conversational.entries.len(), 3);
        assert!(conversational.entries[0].definition.contains("마음"));
        assert!(!conversational
            .entries
            .iter()
            .any(|entry| entry.context_recommended));
        assert!(conversational
            .entries
            .iter()
            .any(|entry| entry.definition.contains("궁궐")));

        let historical = store
            .lookup_with_context(
                "정신",
                "조선 궁궐의 신하를 가리키는 역사 용어",
                Some("ko"),
                "ko",
            )
            .unwrap();
        assert!(historical.entries[0].definition.contains("궁궐"));
        assert!(historical.entries[0].context_recommended);
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
    fn removing_a_pack_reclaims_its_sqlite_file_space() {
        let store = temporary_store("pack-compaction");
        let entries = (0..2_000)
            .map(|index| StarterEntry {
                headword: format!("compaction-test-{index}"),
                reading: String::new(),
                part_of_speech: "noun".to_string(),
                sense_rank: 0,
                glosses: HashMap::from([(
                    "en".to_string(),
                    format!("definition {index} {}", "content ".repeat(40)),
                )]),
                examples: HashMap::new(),
            })
            .collect();
        store
            .install_pack(&StarterPack {
                id: "test-en-compaction".to_string(),
                language: "en".to_string(),
                version: "2026.08.20.1".to_string(),
                title: "Compaction test".to_string(),
                source_name: "Test".to_string(),
                source_url: "https://example.com".to_string(),
                license: "Test".to_string(),
                edition: "practical".to_string(),
                entries,
            })
            .unwrap();
        let bytes_before = store.status().unwrap().database_bytes;

        assert!(store.remove_pack("en").unwrap());
        let bytes_after = store.status().unwrap().database_bytes;

        assert!(
            bytes_after < bytes_before / 2,
            "{bytes_after} should be much smaller than {bytes_before}"
        );
    }

    #[test]
    fn catalog_covers_all_product_languages() {
        let store = temporary_store("catalog");
        let catalog = store.pack_catalog().unwrap();
        assert_eq!(catalog.len(), 28);
        assert_eq!(
            catalog
                .iter()
                .filter(|pack| pack.availability == "practical")
                .count(),
            5
        );
    }

    #[test]
    fn japanese_practical_pack_covers_the_reported_selection() {
        let catalog = super::practical_catalog("ja").unwrap();
        let pack = &catalog.packs[0];
        assert_eq!(pack.edition, "practical");
        assert!(pack.entries.iter().any(|entry| entry.headword == "調べ"));
        assert!(pack.entries.len() >= 90_000);
        assert_eq!(
            pack.entries
                .iter()
                .filter(|entry| entry.headword == "時間")
                .map(|entry| entry.glosses["en"].as_str())
                .collect::<Vec<_>>(),
            vec!["time", "hour", "period; class; lesson"]
        );
    }

    #[test]
    fn japanese_practical_pack_installs_and_finds_the_reported_selection() {
        let store = temporary_store("japanese-practical");
        let status = store.install_bundled_pack("ja").unwrap();
        assert_eq!(status.edition, "practical");
        assert!(status.entry_count >= 50_000);

        let result = store.lookup("調べ", Some("ja"), "ko").unwrap();
        let entry = result
            .entries
            .iter()
            .find(|entry| entry.headword == "調べ")
            .expect("調べ should be available after installing the Japanese practical pack");
        assert_eq!(entry.reading, "しらべ");
        assert!(!entry.definition.is_empty());

        let time = store
            .lookup_with_context(
                "時間",
                "日本時間3/17の午後にシステムが変更されました。",
                Some("ja"),
                "ko",
            )
            .unwrap();
        assert_eq!(
            time.entries
                .iter()
                .filter(|entry| entry.headword == "時間")
                .map(|entry| entry.definition.as_str())
                .collect::<Vec<_>>(),
            vec!["time", "hour", "period; class; lesson"]
        );
        assert!(!time.entries[0].context_recommended);

        let inflected = store
            .lookup_with_context(
                "巡り",
                "今回は夏っぽいワールドを巡りつつまったり交流したいです。",
                Some("ja"),
                "ko",
            )
            .unwrap();
        assert!(inflected
            .entries
            .iter()
            .any(|entry| { entry.headword == "巡る" && entry.part_of_speech == "verb" }));

        let past = store.lookup("食べた", Some("ja"), "ko").unwrap();
        assert!(past.entries.iter().any(|entry| entry.headword == "食べる"));

        let continuative = store.lookup("遊んで", Some("ja"), "ko").unwrap();
        assert!(continuative
            .entries
            .iter()
            .any(|entry| entry.headword == "遊ぶ"));

        let polite_phrase = store
            .lookup_with_context(
                "こんにちは、お世話になります",
                "こんにちは、お世話になります。今後ともよろしくお願いします。",
                Some("ja"),
                "ko",
            )
            .unwrap();
        assert!(polite_phrase.segmented);
        let polite_headwords = polite_phrase
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(polite_headwords.contains(&"こんにちは"));
        assert!(polite_headwords.contains(&"お世話になる"));
        assert!(!polite_headwords.contains(&"なり"));
        assert!(!polite_headwords.contains(&"ます"));

        let phrase = store.lookup("非難禁止", Some("ja"), "ko").unwrap();
        assert!(phrase.segmented);
        let headwords = phrase
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(headwords.contains(&"非難"));
        assert!(headwords.contains(&"禁止"));

        let time_phrase = store.lookup("日本時間", Some("ja"), "ko").unwrap();
        assert!(!time_phrase.segmented);
        assert!(time_phrase.entries.iter().any(|entry| {
            entry.headword == "日本時間"
                && entry
                    .original_definition
                    .split(';')
                    .any(|definition| definition.trim() == "Japan time")
        }));

        let notice_phrase = store
            .lookup(
                "方針変更、またはプレイヤーからの通報などの影響により、",
                Some("ja"),
                "ko",
            )
            .unwrap();
        assert!(notice_phrase.segmented);
        let notice_headwords = notice_phrase
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(notice_headwords.contains(&"方針"));
        assert!(notice_headwords.contains(&"変更"));
        assert!(notice_headwords.contains(&"プレイヤー"));
        assert!(notice_headwords.contains(&"通報"));
        assert!(notice_headwords.contains(&"影響"));
    }

    #[test]
    fn korean_practical_pack_preserves_and_safely_orders_the_reported_mind_senses() {
        let catalog = super::practical_catalog("ko").unwrap();
        let senses = catalog.packs[0]
            .entries
            .iter()
            .filter(|entry| entry.headword == "정신")
            .collect::<Vec<_>>();
        assert_eq!(senses.len(), 6);
        assert!(senses
            .iter()
            .any(|entry| entry.glosses["ko"].contains("마음")));

        let store = temporary_store("korean-practical-context");
        store.install_bundled_pack("ko").unwrap();
        let result = store
            .lookup_with_context(
                "조금씩 정신이 드는 중",
                "조금씩 정신이 드는 중",
                Some("ko"),
                "ko",
            )
            .unwrap();
        let mind_senses = result
            .entries
            .iter()
            .filter(|entry| entry.headword == "정신")
            .collect::<Vec<_>>();
        assert_eq!(mind_senses.len(), 6);
        assert!(mind_senses[0].definition.contains("마음"));
        assert!(!mind_senses.iter().any(|entry| entry.context_recommended));
        assert!(mind_senses
            .iter()
            .skip(1)
            .any(|entry| entry.definition.contains("(역사)")));

        let polite = store.lookup("먹어요", Some("ko"), "ko").unwrap();
        assert!(polite.entries.iter().any(|entry| entry.headword == "먹다"));

        let irregular = store.lookup("했어요", Some("ko"), "ko").unwrap();
        assert!(irregular
            .entries
            .iter()
            .any(|entry| entry.headword == "하다"));

        let particle = store.lookup("정신이", Some("ko"), "ko").unwrap();
        assert!(particle
            .entries
            .iter()
            .any(|entry| entry.headword == "정신"));
    }

    #[test]
    fn english_practical_pack_resolves_common_inflections_after_exact_lookup_misses() {
        let store = temporary_store("english-inflections");
        store.install_bundled_pack("en").unwrap();

        let plural = store.lookup("experiences", Some("en"), "ko").unwrap();
        assert!(plural
            .entries
            .iter()
            .any(|entry| entry.headword == "experience"));

        let past = store.lookup("completed", Some("en"), "ko").unwrap();
        assert!(past
            .entries
            .iter()
            .any(|entry| entry.headword == "complete"));

        let progressive = store.lookup("running", Some("en"), "ko").unwrap();
        assert!(progressive
            .entries
            .iter()
            .any(|entry| entry.headword == "run"));
    }

    #[test]
    fn chinese_practical_packs_follow_the_selected_writing_system() {
        let simplified = temporary_store("simplified-chinese-script");
        simplified.install_bundled_pack("zh").unwrap();
        let result = simplified.lookup("喜欢", Some("zh"), "ko").unwrap();
        assert!(result.entries.iter().any(|entry| entry.headword == "喜欢"));
        assert!(!result.entries.iter().any(|entry| entry.headword == "喜歡"));

        let traditional = temporary_store("traditional-chinese-script");
        traditional.install_bundled_pack("zh-Hant").unwrap();
        let result = traditional.lookup("喜歡", Some("zh-Hant"), "ko").unwrap();
        assert!(result.entries.iter().any(|entry| entry.headword == "喜歡"));
    }

    #[test]
    fn korean_clause_ending_does_not_surface_an_unrelated_noun_homograph() {
        let store = temporary_store("korean-grammar-homograph");
        store.install_bundled_pack("ko").unwrap();

        let result = store
            .lookup_with_context(
                "그만큼 좋아하는게 많다는거지~",
                "그만큼 좋아하는게 많다는거지~",
                Some("ko"),
                "ko",
            )
            .unwrap();
        let headwords = result
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();

        assert!(headwords.contains(&"그만큼"));
        assert!(headwords.contains(&"많다"));
        assert!(!headwords.contains(&"거지"));

        let lexical = store.lookup("가난한 거지", Some("ko"), "ko").unwrap();
        assert!(lexical.entries.iter().any(|entry| entry.headword == "거지"));

        let exact = store.lookup("거지", Some("ko"), "ko").unwrap();
        assert!(exact.entries.iter().any(|entry| entry.headword == "거지"));
    }

    #[test]
    fn korean_unknown_word_does_not_surface_an_inner_inflected_verb() {
        let store = temporary_store("korean-inner-inflection");
        store.install_bundled_pack("ko").unwrap();

        let unknown = store
            .lookup_with_context(
                "샘알트만이 지갑을 탐내요",
                "샘알트만이 지갑을 탐내요",
                Some("ko"),
                "ko",
            )
            .unwrap();
        assert!(unknown.entries.iter().any(|entry| entry.headword == "지갑"));
        assert!(!unknown.entries.iter().any(|entry| entry.headword == "내다"));

        let standalone = store.lookup("돈을 내요", Some("ko"), "ko").unwrap();
        assert!(standalone
            .entries
            .iter()
            .any(|entry| entry.headword == "내다"));
    }

    #[test]
    fn korean_casual_double_past_resolves_the_base_verb() {
        let store = temporary_store("korean-casual-double-past");
        store.install_bundled_pack("ko").unwrap();

        let result = store
            .lookup_with_context("자기 잠들었었어?", "자기 잠들었었어?", Some("ko"), "ko")
            .unwrap();
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.headword == "잠들다"));
        assert!(!result.entries.iter().any(|entry| entry.headword == "었었"));

        let sleep_senses = result
            .entries
            .iter()
            .filter(|entry| entry.headword == "잠들다")
            .collect::<Vec<_>>();
        assert_eq!(sleep_senses.len(), 2);
        assert!(sleep_senses[0].definition.contains("잠을 자고"));
        assert!(!sleep_senses[0].context_recommended);
    }

    #[test]
    fn korean_colloquial_contraction_resolves_base_predicates() {
        let store = temporary_store("korean-colloquial-contraction");
        store.install_bundled_pack("ko").unwrap();

        let result = store
            .lookup_with_context("그런거같애", "그런거같애", Some("ko"), "ko")
            .unwrap();
        let headwords = result
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(headwords.contains(&"그렇다"));
        assert!(headwords.contains(&"같다"));
        assert!(!headwords.contains(&"그런"));
    }

    #[test]
    fn korean_grammar_homograph_filter_is_position_aware() {
        for query in [
            "먹는거지",
            "좋은거지",
            "할거지",
            "이거지",
            "그거지",
            "저거지",
        ] {
            let chars = query.chars().collect::<Vec<_>>();
            let span = lookup_spans(query, "ko")
                .into_iter()
                .find(|span| span.term == "거지")
                .unwrap();
            assert!(!segmentation_candidate_is_plausible(&chars, "ko", &span));
        }

        let lexical = "가난한 거지";
        let chars = lexical.chars().collect::<Vec<_>>();
        let span = lookup_spans(lexical, "ko")
            .into_iter()
            .find(|span| span.term == "거지")
            .unwrap();
        assert!(segmentation_candidate_is_plausible(&chars, "ko", &span));
    }
}
