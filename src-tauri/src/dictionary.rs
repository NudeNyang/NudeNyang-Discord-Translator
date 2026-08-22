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

use crate::dictionary_morphology::{
    analysis_profile, grammar_spans, inflection_terms, is_attached_grammar_surface,
    normalize_segmentation_query as normalize_query_for_segmentation,
    single_syllable_inflection_spans, BoundaryStrategy,
};
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
    #[serde(default)]
    source_priority: i64,
    #[serde(default)]
    source_name: String,
    #[serde(default)]
    source_url: String,
    #[serde(default)]
    license: String,
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
    #[serde(skip)]
    pub source_priority: i64,
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
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub pinned: bool,
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

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDictionaryQuery {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub source_language: String,
    #[serde(default)]
    pub target_language: String,
    #[serde(default)]
    pub pinned_only: bool,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub limit: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDictionaryPage {
    pub entries: Vec<PersonalDictionaryEntry>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDictionaryBatch {
    pub entries: Vec<PersonalDictionaryEntry>,
    #[serde(default = "default_true")]
    pub overwrite: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDictionaryBatchResult {
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
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
                        tags, pinned, scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
                 FROM personal_dictionary ORDER BY updated_at DESC, id DESC",
            )
            .map_err(|error| format!("개인 사전 목록 조회를 준비하지 못했습니다: {error}"))?;
        let rows = statement
            .query_map([], personal_from_row)
            .map_err(|error| format!("개인 사전 목록을 조회하지 못했습니다: {error}"))?;
        rows.map(|row| row.map_err(|error| format!("개인 사전 항목을 읽지 못했습니다: {error}")))
            .collect()
    }

    pub fn personal_entries_page(
        &self,
        query: PersonalDictionaryQuery,
    ) -> Result<PersonalDictionaryPage, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let search = personal_search_pattern(&query.search);
        let source_language = if is_supported_language_code(&query.source_language) {
            query.source_language
        } else {
            String::new()
        };
        let target_language =
            if query.target_language == "*" || is_supported_language_code(&query.target_language) {
                query.target_language
            } else {
                String::new()
            };
        let sort = match query.sort.as_str() {
            "source" | "source_asc" => "source",
            "target" | "target_asc" => "target",
            "oldest" => "oldest",
            _ => "updated",
        }
        .to_string();
        let limit = if query.limit == 0 {
            80
        } else {
            query.limit.clamp(1, 200)
        };
        let total = connection
            .query_row(
                "SELECT COUNT(*) FROM personal_dictionary \
                 WHERE (?1='%' OR source_term LIKE ?1 ESCAPE '\\' OR target_term LIKE ?1 ESCAPE '\\' \
                   OR note LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\') \
                   AND (?2='' OR source_language=?2) AND (?3='' OR target_language=?3) \
                   AND (?4=0 OR pinned=1)",
                params![search, source_language, target_language, query.pinned_only],
                |row| row.get::<_, u64>(0),
            )
            .map_err(|error| format!("개인 사전 검색 결과 수를 확인하지 못했습니다: {error}"))?;
        let mut statement = connection
            .prepare(
                "SELECT id, source_language, target_language, source_term, target_term, note, \
                        tags, pinned, scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
                 FROM personal_dictionary \
                 WHERE (?1='%' OR source_term LIKE ?1 ESCAPE '\\' OR target_term LIKE ?1 ESCAPE '\\' \
                   OR note LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\') \
                   AND (?2='' OR source_language=?2) AND (?3='' OR target_language=?3) \
                   AND (?4=0 OR pinned=1) \
                  ORDER BY CASE WHEN ?5='source' THEN normalized_source_term END COLLATE NOCASE ASC, \
                    CASE WHEN ?5='target' THEN target_term END COLLATE NOCASE ASC, \
                    CASE WHEN ?5='oldest' THEN updated_at END ASC, \
                    CASE WHEN ?5='oldest' THEN id END ASC, \
                    CASE WHEN ?5='updated' THEN updated_at END DESC, \
                    CASE WHEN ?5='updated' THEN id END DESC, id DESC \
                 LIMIT ?6 OFFSET ?7",
            )
            .map_err(|error| format!("개인 사전 검색을 준비하지 못했습니다: {error}"))?;
        let entries = statement
            .query_map(
                params![
                    search,
                    source_language,
                    target_language,
                    query.pinned_only,
                    sort,
                    limit,
                    query.offset
                ],
                personal_from_row,
            )
            .map_err(|error| format!("개인 사전을 검색하지 못했습니다: {error}"))?
            .map(|row| row.map_err(|error| format!("개인 사전 항목을 읽지 못했습니다: {error}")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PersonalDictionaryPage {
            entries,
            total,
            offset: query.offset,
            limit,
        })
    }

    pub fn upsert_personal(
        &self,
        entry: PersonalDictionaryEntry,
    ) -> Result<PersonalDictionaryEntry, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        upsert_personal_connection(&connection, entry)
    }

    pub fn upsert_personal_batch(
        &self,
        batch: PersonalDictionaryBatch,
    ) -> Result<PersonalDictionaryBatchResult, String> {
        if batch.entries.is_empty() {
            return Ok(PersonalDictionaryBatchResult::default());
        }
        if batch.entries.len() > 5_000 {
            return Err("한 번에 가져올 수 있는 개인 사전 항목은 5,000개입니다.".to_string());
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("개인 사전 일괄 저장을 시작하지 못했습니다: {error}"))?;
        let mut result = PersonalDictionaryBatchResult::default();
        for entry in batch.entries {
            let entry = prepare_personal_entry(entry)?;
            let existing = personal_entry_id(&transaction, &entry)?;
            if existing.is_some() && !batch.overwrite {
                result.skipped += 1;
                continue;
            }
            let inserted = existing.is_none();
            upsert_personal_connection(&transaction, entry)?;
            if inserted {
                result.inserted += 1;
            } else {
                result.updated += 1;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("개인 사전 일괄 저장을 완료하지 못했습니다: {error}"))?;
        Ok(result)
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

    pub fn delete_personal_batch(&self, ids: Vec<i64>) -> Result<u64, String> {
        let ids = ids.into_iter().filter(|id| *id > 0).collect::<HashSet<_>>();
        if ids.is_empty() {
            return Ok(0);
        }
        if ids.len() > 5_000 {
            return Err("한 번에 삭제할 수 있는 개인 사전 항목은 5,000개입니다.".to_string());
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "개인 사전 저장소 잠금을 열지 못했습니다.".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("개인 사전 일괄 삭제를 시작하지 못했습니다: {error}"))?;
        let mut removed = 0;
        for id in ids {
            removed += transaction
                .execute("DELETE FROM personal_dictionary WHERE id=?1", params![id])
                .map_err(|error| format!("개인 사전 항목을 삭제하지 못했습니다: {error}"))?
                as u64;
        }
        transaction
            .commit()
            .map_err(|error| format!("개인 사전 일괄 삭제를 완료하지 못했습니다: {error}"))?;
        Ok(removed)
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
                    "INSERT INTO dictionary_entries (pack_id, language, headword, normalized_headword, reading, part_of_speech, sense_rank, source_priority, source_name, source_url, license) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![pack.id, pack.language, entry.headword, normalize_term(&entry.headword), entry.reading, entry.part_of_speech, entry.sense_rank,
                        entry.source_priority, entry.source_name, entry.source_url, entry.license],
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
    derived: bool,
    display: bool,
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
                    COALESCE(NULLIF(e.source_name,''), p.source_name), \
                    COALESCE(NULLIF(e.source_url,''), p.source_url), \
                    COALESCE(NULLIF(e.license,''), p.license), e.sense_rank, e.source_priority \
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
             ORDER BY CASE WHEN e.language=?3 THEN 0 ELSE 1 END, e.source_priority, e.sense_rank, e.id LIMIT ?4",
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
                    tags, pinned, scope, scope_value, case_sensitive, whole_word, created_at, updated_at \
             FROM personal_dictionary \
             WHERE normalized_source_term=?1 AND (?2='' OR source_language=?2) \
               AND (target_language=?3 OR target_language='*') \
             ORDER BY pinned DESC, updated_at DESC LIMIT ?4",
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
    inflection_terms(normalized_term, detected_language)
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

fn segment_lookup_terms(
    connection: &Connection,
    normalized_query: &str,
    detected_language: &str,
    target_language: &str,
) -> Result<Vec<String>, String> {
    let segmentation_query = normalize_query_for_segmentation(normalized_query, detected_language);
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
                let derived = span.term != candidate;
                matched.push(LookupSpan {
                    term: candidate,
                    start: span.start,
                    end: span.end,
                    derived,
                    display: true,
                });
                break;
            }
        }
    }

    if detected_language == "ko" {
        for (term, start, end) in single_syllable_inflection_spans(&query_chars, detected_language)
        {
            let available = if let Some(available) = availability.get(&term) {
                *available
            } else {
                let in_dictionary = dictionary_exists
                    .query_row(params![term, detected_language], |_| Ok(()))
                    .optional()
                    .map_err(|error| format!("사전 표현을 확인하지 못했습니다: {error}"))?
                    .is_some();
                availability.insert(term.clone(), in_dictionary);
                in_dictionary
            };
            if available {
                matched.push(LookupSpan {
                    term,
                    start,
                    end,
                    derived: true,
                    display: true,
                });
            }
        }
        matched.extend(
            grammar_spans(&query_chars, detected_language)
                .into_iter()
                .map(|(start, end)| LookupSpan {
                    term: String::new(),
                    start,
                    end,
                    derived: true,
                    display: false,
                }),
        );
        retain_complete_korean_token_coverages(&mut matched, &query_chars);
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
        if best.display && returned.insert(best.term.clone()) {
            terms.push(best.term.clone());
        }
    }
    Ok(terms)
}

fn retain_complete_korean_token_coverages(matched: &mut Vec<LookupSpan>, query_chars: &[char]) {
    let mut accepted = vec![false; matched.len()];
    let mut token_start = 0;
    while token_start < query_chars.len() {
        if !query_chars[token_start].is_alphanumeric() {
            token_start += 1;
            continue;
        }
        let mut token_end = token_start + 1;
        while token_end < query_chars.len() && query_chars[token_end].is_alphanumeric() {
            token_end += 1;
        }

        let internal = matched
            .iter()
            .enumerate()
            .filter(|(_, span)| span.start >= token_start && span.end <= token_end)
            .collect::<Vec<_>>();
        for (index, span) in &internal {
            if span.derived && span.display && span.start == token_start {
                accepted[*index] = true;
            }
        }
        let mut reachable_from_start = HashSet::from([token_start]);
        let mut changed = true;
        while changed {
            changed = false;
            for (_, span) in &internal {
                if reachable_from_start.contains(&span.start)
                    && reachable_from_start.insert(span.end)
                {
                    changed = true;
                }
            }
        }
        if reachable_from_start.contains(&token_end) {
            let mut reachable_to_end = HashSet::from([token_end]);
            let mut changed = true;
            while changed {
                changed = false;
                for (_, span) in &internal {
                    if reachable_to_end.contains(&span.end) && reachable_to_end.insert(span.start) {
                        changed = true;
                    }
                }
            }
            for (index, span) in &internal {
                if reachable_from_start.contains(&span.start)
                    && reachable_to_end.contains(&span.end)
                {
                    accepted[*index] = true;
                }
            }
        }
        token_start = token_end;
    }

    for (index, span) in matched.iter().enumerate() {
        if query_chars[span.start..span.end]
            .iter()
            .any(|character| !character.is_alphanumeric())
        {
            accepted[index] = true;
        }
    }
    let mut index = 0;
    matched.retain(|_| {
        let keep = accepted[index];
        index += 1;
        keep
    });
}

fn prefer_korean_base_form(term: &str, detected_language: &str) -> bool {
    detected_language == "ko" && matches!(term, "그런" | "이런" | "저런")
}

fn segmented_inflection_candidate_is_plausible(
    query_chars: &[char],
    detected_language: &str,
    span: &LookupSpan,
) -> bool {
    if detected_language != "ko" {
        return true;
    }
    if query_chars[span.start..span.end]
        .iter()
        .any(|character| !character.is_alphanumeric())
    {
        return false;
    }
    true
}

fn segmentation_candidate_is_plausible(
    query_chars: &[char],
    detected_language: &str,
    span: &LookupSpan,
) -> bool {
    match detected_language {
        "ko" => !is_attached_grammar_surface(
            query_chars,
            detected_language,
            &span.term,
            span.start,
            span.end,
        ),
        _ => true,
    }
}

fn lookup_spans(normalized_query: &str, detected_language: &str) -> Vec<LookupSpan> {
    let chars = normalized_query.chars().collect::<Vec<_>>();
    let compact = analysis_profile(detected_language)
        .is_some_and(|profile| profile.boundaries == BoundaryStrategy::Compact)
        || chars.iter().copied().any(is_compact_dictionary_character);
    let mut spans = Vec::new();
    for start in 0..chars.len() {
        if !chars[start].is_alphanumeric()
            || (!compact && start > 0 && chars[start - 1].is_alphanumeric())
        {
            continue;
        }
        let max_end = (start + 24).min(chars.len());
        for end in (start + 1)..=max_end {
            let single_character = end == start + 1;
            if single_character
                && (start > 0 && chars[start - 1].is_alphanumeric()
                    || end < chars.len() && chars[end].is_alphanumeric())
            {
                continue;
            }
            if !chars[end - 1].is_alphanumeric()
                || (!compact && end < chars.len() && chars[end].is_alphanumeric())
            {
                continue;
            }
            spans.push(LookupSpan {
                term: chars[start..end].iter().collect(),
                start,
                end,
                derived: false,
                display: true,
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
        source_priority: row.get(15)?,
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
            left.source_priority
                .cmp(&right.source_priority)
                .then_with(|| left.sense_rank.cmp(&right.sense_rank))
                .then_with(|| left.entry_id.cmp(&right.entry_id))
        });
        if group.len() > 1 {
            let mut scored = group
                .iter()
                .enumerate()
                .map(|(index, entry)| {
                    (
                        index,
                        contextual_sense_score(entry, &normalized_context, context_language),
                    )
                })
                .collect::<Vec<_>>();
            scored.sort_by(|(left_index, left), (right_index, right)| {
                right
                    .ranking
                    .cmp(&left.ranking)
                    .then_with(|| left_index.cmp(right_index))
            });
            let (best_index, best) = scored[0];
            let second = scored[1].1;
            if best.ranking > 0
                && best.evidence >= 24
                && best.ranking.saturating_sub(second.ranking) >= 12
            {
                let mut preferred = group.remove(best_index);
                preferred.context_recommended = true;
                group.insert(0, preferred);
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
        let context_tokens = context
            .split(|character: char| !character.is_alphanumeric())
            .filter(|token| contextual_token_is_informative(token, definition_language))
            .collect::<HashSet<_>>();
        for token in normalized_definition
            .split(|character: char| !character.is_alphanumeric())
            .filter(|token| contextual_token_is_informative(token, definition_language))
        {
            if context_tokens.contains(token) {
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
            "are", "or", "an", "of", "to", "in", "for", "on", "by", "as", "at", "it", "its",
            "which", "when", "during",
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
        tags: row.get(6)?,
        pinned: row.get(7)?,
        scope: row.get(8)?,
        scope_value: row.get(9)?,
        case_sensitive: row.get(10)?,
        whole_word: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn prepare_personal_entry(
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
    entry.tags = normalize_personal_tags(&entry.tags);
    if !matches!(entry.scope.as_str(), "global" | "server" | "channel") {
        entry.scope = default_scope();
    }
    if entry.scope == "global" {
        entry.scope_value.clear();
    } else if !entry.scope_value.starts_with("/channels/") {
        return Err("서버 또는 채널 적용 범위가 올바르지 않습니다.".to_string());
    }
    Ok(entry)
}

fn personal_entry_id(
    connection: &Connection,
    entry: &PersonalDictionaryEntry,
) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "SELECT id FROM personal_dictionary WHERE source_language=?1 AND target_language=?2 \
             AND normalized_source_term=?3 AND scope=?4 AND scope_value=?5",
            params![
                entry.source_language,
                entry.target_language,
                normalize_term(&entry.source_term),
                entry.scope,
                entry.scope_value
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("개인 사전의 중복 항목을 확인하지 못했습니다: {error}"))
}

fn upsert_personal_connection(
    connection: &Connection,
    entry: PersonalDictionaryEntry,
) -> Result<PersonalDictionaryEntry, String> {
    let mut entry = prepare_personal_entry(entry)?;
    let now = now_seconds();
    let normalized = normalize_term(&entry.source_term);
    if entry.id > 0 {
        let changed = connection
            .execute(
                "UPDATE personal_dictionary SET source_language=?1, target_language=?2, source_term=?3, \
                   normalized_source_term=?4, target_term=?5, note=?6, tags=?7, pinned=?8, scope=?9, scope_value=?10, \
                   case_sensitive=?11, whole_word=?12, updated_at=?13 WHERE id=?14",
                params![
                    entry.source_language,
                    entry.target_language,
                    entry.source_term,
                    normalized,
                    entry.target_term,
                    entry.note,
                    entry.tags,
                    entry.pinned,
                    entry.scope,
                    entry.scope_value,
                    entry.case_sensitive,
                    entry.whole_word,
                    now,
                    entry.id
                ],
            )
            .map_err(|error| format!("개인 사전 항목을 수정하지 못했습니다: {error}"))?;
        if changed == 0 {
            return Err("수정할 개인 사전 항목을 찾지 못했습니다.".to_string());
        }
    } else {
        connection
            .execute(
                "INSERT INTO personal_dictionary \
                 (source_language, target_language, source_term, normalized_source_term, target_term, note, tags, pinned, \
                  scope, scope_value, case_sensitive, whole_word, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13) \
                 ON CONFLICT(source_language, target_language, normalized_source_term, scope, scope_value) \
                 DO UPDATE SET source_term=excluded.source_term, target_term=excluded.target_term, note=excluded.note, \
                   tags=excluded.tags, pinned=excluded.pinned, case_sensitive=excluded.case_sensitive, \
                   whole_word=excluded.whole_word, updated_at=excluded.updated_at",
                params![
                    entry.source_language,
                    entry.target_language,
                    entry.source_term,
                    normalized,
                    entry.target_term,
                    entry.note,
                    entry.tags,
                    entry.pinned,
                    entry.scope,
                    entry.scope_value,
                    entry.case_sensitive,
                    entry.whole_word,
                    now
                ],
            )
            .map_err(|error| format!("개인 사전 항목을 저장하지 못했습니다: {error}"))?;
        entry.id = personal_entry_id(connection, &entry)?
            .ok_or_else(|| "저장한 개인 사전 항목을 찾지 못했습니다.".to_string())?;
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

fn personal_search_pattern(value: &str) -> String {
    let value = value.trim().chars().take(120).collect::<String>();
    if value.is_empty() {
        return "%".to_string();
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn normalize_personal_tags(value: &str) -> String {
    let mut seen = HashSet::new();
    value
        .split([',', ';', '#'])
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.to_lowercase()))
        .take(12)
        .map(|tag| tag.chars().take(32).collect::<String>())
        .collect::<Vec<_>>()
        .join(", ")
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
           sense_rank INTEGER NOT NULL DEFAULT 0, source_priority INTEGER NOT NULL DEFAULT 0, \
           source_name TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', license TEXT NOT NULL DEFAULT ''); \
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
           tags TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, \
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
    let entry_columns = connection
        .prepare("PRAGMA table_info(dictionary_entries)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|error| format!("사전 항목 출처 저장 형식을 확인하지 못했습니다: {error}"))?;
    for (column, declaration) in [
        (
            "source_priority",
            "ALTER TABLE dictionary_entries ADD COLUMN source_priority INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "source_name",
            "ALTER TABLE dictionary_entries ADD COLUMN source_name TEXT NOT NULL DEFAULT ''",
        ),
        (
            "source_url",
            "ALTER TABLE dictionary_entries ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
        ),
        (
            "license",
            "ALTER TABLE dictionary_entries ADD COLUMN license TEXT NOT NULL DEFAULT ''",
        ),
    ] {
        if !entry_columns.iter().any(|existing| existing == column) {
            connection.execute(declaration, []).map_err(|error| {
                format!("사전 항목 출처 저장 형식을 갱신하지 못했습니다: {error}")
            })?;
        }
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
    let personal_columns = connection
        .prepare("PRAGMA table_info(personal_dictionary)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|error| format!("개인 사전 저장 형식을 확인하지 못했습니다: {error}"))?;
    for (column, declaration) in [
        (
            "tags",
            "ALTER TABLE personal_dictionary ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
        ),
        (
            "pinned",
            "ALTER TABLE personal_dictionary ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        if !personal_columns.iter().any(|existing| existing == column) {
            connection
                .execute(declaration, [])
                .map_err(|error| format!("개인 사전 저장 형식을 갱신하지 못했습니다: {error}"))?;
        }
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

    use rusqlite::params;

    use super::{
        lookup_spans, segment_lookup_terms, segmentation_candidate_is_plausible, DictionaryStore,
        PersonalDictionaryBatch, PersonalDictionaryEntry, PersonalDictionaryQuery, StarterEntry,
        StarterPack,
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
            source_priority: 0,
            source_name: String::new(),
            source_url: String::new(),
            license: String::new(),
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
    fn legacy_entry_schema_is_migrated_for_layered_sources() {
        let path = std::env::temp_dir().join(format!(
            "nudenyang-dictionary-layer-migration-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE dictionary_packs ( \
                   id TEXT PRIMARY KEY, language TEXT NOT NULL UNIQUE, version TEXT NOT NULL, title TEXT NOT NULL, \
                   source_name TEXT NOT NULL, source_url TEXT NOT NULL, license TEXT NOT NULL, \
                   edition TEXT NOT NULL DEFAULT 'mini', entry_count INTEGER NOT NULL, installed_at REAL NOT NULL); \
                 CREATE TABLE dictionary_entries ( \
                   id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id TEXT NOT NULL REFERENCES dictionary_packs(id) ON DELETE CASCADE, \
                   language TEXT NOT NULL, headword TEXT NOT NULL, normalized_headword TEXT NOT NULL, \
                   reading TEXT NOT NULL DEFAULT '', part_of_speech TEXT NOT NULL DEFAULT 'other', \
                   sense_rank INTEGER NOT NULL DEFAULT 0);",
            )
            .unwrap();
        drop(connection);

        let store = DictionaryStore::open(path).unwrap();
        let columns = store
            .connection
            .lock()
            .unwrap()
            .prepare("PRAGMA table_info(dictionary_entries)")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        for expected in ["source_priority", "source_name", "source_url", "license"] {
            assert!(columns.iter().any(|column| column == expected));
        }
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
    fn weak_english_function_word_overlap_does_not_promote_an_unrelated_sense() {
        let store = temporary_store("english-context-confidence");
        let sense = |definition: &str, sense_rank| StarterEntry {
            headword: "period".to_string(),
            reading: "ˈpɪə.rɪ.əd".to_string(),
            part_of_speech: "noun".to_string(),
            sense_rank,
            source_priority: 0,
            source_name: String::new(),
            source_url: String::new(),
            license: String::new(),
            glosses: HashMap::from([("en".to_string(), definition.to_string())]),
            examples: HashMap::new(),
        };
        store
            .install_pack(&StarterPack {
                id: "test-en-context-confidence".to_string(),
                language: "en".to_string(),
                version: "2026.08.22.1".to_string(),
                title: "English context confidence test".to_string(),
                source_name: "Test".to_string(),
                source_url: "https://example.com".to_string(),
                license: "Test".to_string(),
                edition: "mini".to_string(),
                entries: vec![
                    sense("an amount of time", 0),
                    sense(
                        "a unit of geological time during which a system of rocks formed",
                        1,
                    ),
                ],
            })
            .unwrap();

        let event = store
            .lookup_with_context(
                "period",
                "Submissions must be made during the event period.",
                Some("en"),
                "en",
            )
            .unwrap();
        assert_eq!(event.entries[0].definition, "an amount of time");
        assert!(!event.entries[0].context_recommended);

        let geological = store
            .lookup_with_context(
                "period",
                "This geological period formed a system of rocks.",
                Some("en"),
                "en",
            )
            .unwrap();
        assert!(geological.entries[0].definition.contains("geological time"));
        assert!(geological.entries[0].context_recommended);
    }

    #[test]
    fn layered_pack_keeps_primary_source_first_and_preserves_attribution() {
        let store = temporary_store("layered-attribution");
        let mut primary = test_sense("퇴근", "직장에서 일을 끝내고 집으로 돌아가거나 돌아옴.", 0);
        primary.source_priority = 0;
        primary.source_name = "Official learner dictionary".to_string();
        primary.source_url = "https://example.com/primary".to_string();
        primary.license = "CC-BY-SA-2.0-KR".to_string();
        let mut expanded = test_sense("퇴근", "다른 자료에만 있는 뜻.", 1);
        expanded.source_priority = 1;
        expanded.source_name = "Community dictionary".to_string();
        expanded.source_url = "https://example.com/expanded".to_string();
        expanded.license = "CC-BY-SA-4.0".to_string();

        store
            .install_pack(&StarterPack {
                id: "test-ko-layered".to_string(),
                language: "ko".to_string(),
                version: "2026.08.20.1".to_string(),
                title: "Layered test".to_string(),
                source_name: "Combined source".to_string(),
                source_url: "https://example.com/notices".to_string(),
                license: "Multiple".to_string(),
                edition: "mini".to_string(),
                entries: vec![expanded, primary],
            })
            .unwrap();

        let result = store.lookup("퇴근", Some("ko"), "ko").unwrap();
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].source_name, "Official learner dictionary");
        assert_eq!(result.entries[0].license, "CC-BY-SA-2.0-KR");
        assert_eq!(result.entries[1].source_name, "Community dictionary");
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
                tags: "Discord, 캐릭터".into(),
                pinned: true,
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
    fn personal_dictionary_supports_search_pinning_editing_and_batch_management() {
        let store = temporary_store("personal-management");
        let make_entry = |source: &str, target: &str, tags: &str| PersonalDictionaryEntry {
            id: 0,
            source_language: "en".into(),
            target_language: "ko".into(),
            source_term: source.into(),
            target_term: target.into(),
            note: format!("{source} 메모"),
            tags: tags.into(),
            pinned: source == "VRChat",
            scope: "global".into(),
            scope_value: String::new(),
            case_sensitive: false,
            whole_word: true,
            created_at: 0.0,
            updated_at: 0.0,
        };
        let imported = store
            .upsert_personal_batch(PersonalDictionaryBatch {
                entries: vec![
                    make_entry("VRChat", "브이알챗", "게임, Discord, 게임"),
                    make_entry("avatar", "아바타", "캐릭터"),
                ],
                overwrite: true,
            })
            .unwrap();
        assert_eq!(imported.inserted, 2);
        assert_eq!(imported.updated, 0);

        let page = store
            .personal_entries_page(PersonalDictionaryQuery {
                search: "discord".into(),
                limit: 20,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries[0].source_term, "VRChat");
        assert_eq!(page.entries[0].tags, "게임, Discord");
        assert!(page.entries[0].pinned);

        let skipped = store
            .upsert_personal_batch(PersonalDictionaryBatch {
                entries: vec![make_entry("VRChat", "VR챗", "게임")],
                overwrite: false,
            })
            .unwrap();
        assert_eq!(skipped.skipped, 1);
        assert_eq!(
            store
                .delete_personal_batch(vec![page.entries[0].id])
                .unwrap(),
            1
        );
    }

    #[test]
    fn personal_dictionary_oldest_sort_ignores_favorite_priority() {
        let store = temporary_store("personal-oldest-sort");
        let make_entry = |source: &str, pinned: bool| PersonalDictionaryEntry {
            id: 0,
            source_language: "en".into(),
            target_language: "ko".into(),
            source_term: source.into(),
            target_term: format!("{source}-ko"),
            note: String::new(),
            tags: String::new(),
            pinned,
            scope: "global".into(),
            scope_value: String::new(),
            case_sensitive: false,
            whole_word: true,
            created_at: 0.0,
            updated_at: 0.0,
        };
        let older = store.upsert_personal(make_entry("older", false)).unwrap();
        let newer_favorite = store.upsert_personal(make_entry("newer", true)).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE personal_dictionary SET updated_at=CASE id WHEN ?1 THEN 100 ELSE 200 END",
                    params![older.id],
                )
                .unwrap();
        }

        let page = store
            .personal_entries_page(PersonalDictionaryQuery {
                sort: "oldest".into(),
                limit: 20,
                ..Default::default()
            })
            .unwrap();

        assert_eq!(
            page.entries
                .iter()
                .map(|entry| entry.source_term.as_str())
                .collect::<Vec<_>>(),
            vec!["older", "newer"]
        );
        assert!(page.entries[1].pinned);
        assert_eq!(page.entries[1].id, newer_favorite.id);

        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute("UPDATE personal_dictionary SET updated_at=100", [])
                .unwrap();
        }
        let tied_page = store
            .personal_entries_page(PersonalDictionaryQuery {
                sort: "oldest".into(),
                limit: 20,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            tied_page
                .entries
                .iter()
                .map(|entry| entry.source_term.as_str())
                .collect::<Vec<_>>(),
            vec!["older", "newer"]
        );
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
                source_priority: 0,
                source_name: String::new(),
                source_url: String::new(),
                license: String::new(),
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
        assert!(senses.len() >= 10);
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
        assert!(mind_senses.len() >= 10);
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

        let leave_work = store.lookup("퇴근", Some("ko"), "ko").unwrap();
        let leave_work_entry = leave_work
            .entries
            .iter()
            .find(|entry| entry.headword == "퇴근")
            .unwrap();
        assert_eq!(leave_work_entry.source_name, "한국어기초사전, 국립국어원");
        assert!(leave_work_entry.definition.contains("직장에서 일을 끝내고"));

        let overtime = store.lookup("야근하다", Some("ko"), "ko").unwrap();
        assert!(overtime.entries.iter().any(|entry| {
            entry.headword == "야근하다" && entry.definition.contains("밤늦게까지 일하다")
        }));

        let segmented_terms = {
            let connection = store.connection.lock().unwrap();
            segment_lookup_terms(&connection, "홍보 이미지 유출", "ko", "ko").unwrap()
        };
        assert!(
            segmented_terms.contains(&"홍보".to_string()),
            "{segmented_terms:?}"
        );
        assert!(
            segmented_terms.contains(&"이미지".to_string()),
            "{segmented_terms:?}"
        );
        assert!(
            segmented_terms.contains(&"유출".to_string()),
            "{segmented_terms:?}"
        );
        assert!(
            !segmented_terms.contains(&"이미".to_string()),
            "{segmented_terms:?}"
        );

        let media_leak = store.lookup("홍보 이미지 유출", Some("ko"), "ko").unwrap();
        assert!(media_leak.segmented);
        let media_leak_headwords = media_leak
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(
            media_leak_headwords.contains(&"홍보"),
            "{media_leak_headwords:?}"
        );
        assert!(
            media_leak_headwords.contains(&"이미지"),
            "{media_leak_headwords:?}"
        );
        assert!(
            media_leak_headwords.contains(&"유출"),
            "{media_leak_headwords:?}"
        );
        assert!(!media_leak_headwords.contains(&"이미"));
    }

    #[test]
    fn korean_sentence_analysis_handles_endings_grammar_and_colloquial_spacing() {
        let store = temporary_store("korean-sentence-analysis");
        store.install_bundled_pack("ko").unwrap();

        let cute = store.lookup("귀엽네", Some("ko"), "ko").unwrap();
        assert!(
            cute.entries.iter().any(|entry| entry.headword == "귀엽다"),
            "{:?}",
            cute.entries
                .iter()
                .map(|entry| entry.headword.as_str())
                .collect::<Vec<_>>()
        );
        for (surface, base) in [
            ("귀여워요", "귀엽다"),
            ("추운데", "춥다"),
            ("몰라요", "모르다"),
            ("써요", "쓰다"),
        ] {
            let result = store.lookup(surface, Some("ko"), "ko").unwrap();
            assert!(
                result.entries.iter().any(|entry| entry.headword == base),
                "{surface}: {:?}",
                result
                    .entries
                    .iter()
                    .map(|entry| entry.headword.as_str())
                    .collect::<Vec<_>>()
            );
        }

        let copula = store.lookup("무슨조건이지", Some("ko"), "ko").unwrap();
        let copula_headwords = copula
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        assert!(copula_headwords.contains(&"무슨"), "{copula_headwords:?}");
        assert!(copula_headwords.contains(&"조건"), "{copula_headwords:?}");
        assert!(!copula_headwords.contains(&"이지"), "{copula_headwords:?}");

        let casual = store
            .lookup_with_context(
                "왤케 초기화 자주해주냐",
                "왤케 초기화 자주해주냐",
                Some("ko"),
                "ko",
            )
            .unwrap();
        let casual_headwords = casual
            .entries
            .iter()
            .map(|entry| entry.headword.as_str())
            .collect::<Vec<_>>();
        for expected in ["왜", "이렇게", "초기화", "자주", "하다", "주다"] {
            assert!(casual_headwords.contains(&expected), "{casual_headwords:?}");
        }
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
    fn korean_segmentation_does_not_return_a_prefix_with_an_uncovered_hangul_suffix() {
        let store = temporary_store("korean-uncovered-prefix");
        store
            .install_pack(&StarterPack {
                id: "test-ko-uncovered-prefix".to_string(),
                language: "ko".to_string(),
                version: "2026.08.20.1".to_string(),
                title: "Korean prefix test".to_string(),
                source_name: "Test source".to_string(),
                source_url: "https://example.com".to_string(),
                license: "GPL-3.0-only".to_string(),
                edition: "mini".to_string(),
                entries: vec![test_sense(
                    "이미",
                    "어떤 일이 지금보다 앞서 이루어진 상태.",
                    0,
                )],
            })
            .unwrap();

        let result = store.lookup("이미지", Some("ko"), "ko").unwrap();
        assert!(result.entries.is_empty());
    }

    #[test]
    fn korean_hada_contractions_resolve_base_forms() {
        let store = temporary_store("korean-hada-contraction");
        store.install_bundled_pack("ko").unwrap();

        for (query, expected) in [
            ("맹해보여서", "맹하다"),
            ("공부해서", "공부하다"),
            ("좋아해요", "좋아하다"),
        ] {
            let result = store.lookup(query, Some("ko"), "ko").unwrap();
            assert!(
                result
                    .entries
                    .iter()
                    .any(|entry| entry.headword == expected),
                "{query}: {:?}",
                result
                    .entries
                    .iter()
                    .map(|entry| entry.headword.as_str())
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn korean_approximation_particles_resolve_base_nouns() {
        let store = temporary_store("korean-approximation-particle");
        store.install_bundled_pack("ko").unwrap();

        let lunchtime = store.lookup("점심쯤?", Some("ko"), "ko").unwrap();
        assert!(lunchtime
            .entries
            .iter()
            .any(|entry| entry.headword == "점심"));
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
        assert!(sleep_senses.len() >= 2);
        assert_eq!(sleep_senses[0].definition, "잠을 자는 상태가 되다.");
        assert_eq!(sleep_senses[0].source_name, "한국어기초사전, 국립국어원");
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
