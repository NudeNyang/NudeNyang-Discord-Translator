from __future__ import annotations

import logging
import queue
import sqlite3
import threading
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from platformdirs import user_cache_dir

from .models import Language

LOGGER = logging.getLogger("discord_translate_overlay")
CacheKey = tuple[str, str, str]
_WRITE_STOP = object()
_WRITE_BATCH_SIZE = 128


@dataclass(frozen=True, slots=True)
class _CacheEntry:
    source_hash: str
    source_text: str
    source: Language
    target: Language
    translator: str
    translated_text: str
    updated_at: float

    @property
    def key(self) -> CacheKey:
        return self.source_hash, self.target.value, self.translator


class TranslationCache:
    def __init__(
        self,
        path: Path | None = None,
        *,
        memory_capacity: int = 4096,
    ) -> None:
        self.path = (
            path or Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools")) / "cache.db"
        )
        self.memory_capacity = max(0, int(memory_capacity))
        self._memory: OrderedDict[CacheKey, _CacheEntry] = OrderedDict()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._lock = threading.Lock()
        self._closed = False
        self._write_error: BaseException | None = None
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS translations (
                    source_hash TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    source_language TEXT NOT NULL,
                    target_language TEXT NOT NULL,
                    translator TEXT NOT NULL DEFAULT 'deepl:v1',
                    translated_text TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (source_hash, target_language, translator)
                )
                """
            )
        self._migrate_legacy_schema()
        self._write_queue: queue.Queue[_CacheEntry | object] = queue.Queue()
        self._writer = threading.Thread(
            target=self._write_worker,
            name="translation-cache-writer",
            daemon=True,
        )
        self._writer.start()

    def _migrate_legacy_schema(self) -> None:
        columns = {
            str(row[1])
            for row in self._connection.execute("PRAGMA table_info(translations)").fetchall()
        }
        if "translator" in columns:
            return
        with self._connection:
            self._connection.execute("ALTER TABLE translations RENAME TO translations_legacy")
            self._connection.execute(
                """
                CREATE TABLE translations (
                    source_hash TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    source_language TEXT NOT NULL,
                    target_language TEXT NOT NULL,
                    translator TEXT NOT NULL,
                    translated_text TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (source_hash, target_language, translator)
                )
                """
            )
            self._connection.execute(
                """
                INSERT INTO translations
                    (source_hash, source_text, source_language, target_language,
                     translator, translated_text, updated_at)
                SELECT source_hash, source_text, source_language, target_language,
                       'deepl:v1', translated_text, updated_at
                FROM translations_legacy
                """
            )
            self._connection.execute("DROP TABLE translations_legacy")

    def get(
        self,
        source_hash: str,
        target: Language,
        translator: str = "deepl:v1",
    ) -> str | None:
        key = (source_hash, target.value, translator)
        memory = self._memory_get(key)
        if memory is not None:
            return memory.translated_text
        with self._lock:
            row = self._connection.execute(
                "SELECT source_text, source_language, translated_text, updated_at "
                "FROM translations "
                "WHERE source_hash=? AND target_language=? AND translator=?",
                (source_hash, target.value, translator),
            ).fetchone()
        if row is None:
            return None
        entry = _CacheEntry(
            source_hash,
            str(row[0]),
            Language(str(row[1])),
            target,
            translator,
            str(row[2]),
            float(row[3]),
        )
        self._remember(entry)
        return entry.translated_text

    def get_message(
        self,
        source_hash: str,
        source_text: str,
        source: Language,
        target: Language,
        translator: str = "deepl:v1",
        *,
        allow_fuzzy: bool = True,
    ) -> str | None:
        """Reuse a translation even when an OCR box moved or changed by one character."""
        normalized = _normalize_text(source_text)
        key = (source_hash, target.value, translator)
        memory = self._memory_get(key)
        if memory is not None:
            return memory.translated_text

        if allow_fuzzy:
            memory_match = self._memory_fuzzy_match(
                normalized,
                source,
                target,
                translator,
            )
            if memory_match is not None:
                alias = _CacheEntry(
                    source_hash,
                    source_text,
                    source,
                    target,
                    translator,
                    memory_match,
                    time.time(),
                )
                self._remember(alias)
                self._enqueue_write(alias)
                return memory_match

        with self._lock:
            exact = self._connection.execute(
                "SELECT source_text, source_language, translated_text, updated_at "
                "FROM translations "
                "WHERE source_hash=? AND target_language=? AND translator=?",
                (source_hash, target.value, translator),
            ).fetchone()
            if exact is not None:
                entry = _CacheEntry(
                    source_hash,
                    str(exact[0]),
                    Language(str(exact[1])),
                    target,
                    translator,
                    str(exact[2]),
                    float(exact[3]),
                )
                self._remember_locked(entry)
                return entry.translated_text

            if not allow_fuzzy:
                return None

            rows = self._connection.execute(
                "SELECT source_hash, source_text, translated_text, updated_at "
                "FROM translations "
                "WHERE source_language=? AND target_language=? AND translator=? "
                "ORDER BY updated_at DESC",
                (source.value, target.value, translator),
            ).fetchall()
            matched: _CacheEntry | None = None
            for cached_hash, cached_source, translated, updated_at in rows:
                cached_normalized = _normalize_text(str(cached_source))
                if cached_normalized == normalized or (
                    min(len(cached_normalized), len(normalized)) >= 8
                    and _edit_distance_at_most_one(cached_normalized, normalized)
                ):
                    matched = _CacheEntry(
                        str(cached_hash),
                        str(cached_source),
                        source,
                        target,
                        translator,
                        str(translated),
                        float(updated_at),
                    )
                    break
            if matched is None:
                return None
            self._remember_locked(matched)

        alias = _CacheEntry(
            source_hash,
            source_text,
            source,
            target,
            translator,
            matched.translated_text,
            time.time(),
        )
        self._remember(alias)
        self._enqueue_write(alias)
        return alias.translated_text

    def put(
        self,
        source_hash: str,
        source_text: str,
        source: Language,
        target: Language,
        translated_text: str,
        translator: str = "deepl:v1",
    ) -> None:
        entry = _CacheEntry(
            source_hash,
            source_text,
            source,
            target,
            translator,
            translated_text,
            time.time(),
        )
        self._remember(entry)
        self._enqueue_write(entry)

    @property
    def memory_size(self) -> int:
        with self._lock:
            return len(self._memory)

    def memory_contains(
        self,
        source_hash: str,
        target: Language,
        translator: str = "deepl:v1",
    ) -> bool:
        with self._lock:
            return (source_hash, target.value, translator) in self._memory

    def flush(self) -> None:
        self._write_queue.join()
        if self._write_error is not None:
            raise RuntimeError("번역 캐시를 디스크에 저장하지 못했어.") from self._write_error

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._write_queue.put(_WRITE_STOP)
        try:
            self.flush()
        finally:
            self._writer.join()
            with self._lock:
                self._connection.close()

    def _memory_get(self, key: CacheKey) -> _CacheEntry | None:
        with self._lock:
            entry = self._memory.get(key)
            if entry is not None:
                self._memory.move_to_end(key)
            return entry

    def _memory_fuzzy_match(
        self,
        normalized: str,
        source: Language,
        target: Language,
        translator: str,
    ) -> str | None:
        with self._lock:
            for entry in reversed(tuple(self._memory.values())):
                if (
                    entry.source != source
                    or entry.target != target
                    or entry.translator != translator
                ):
                    continue
                cached_normalized = _normalize_text(entry.source_text)
                if cached_normalized == normalized or (
                    min(len(cached_normalized), len(normalized)) >= 8
                    and _edit_distance_at_most_one(cached_normalized, normalized)
                ):
                    self._memory.move_to_end(entry.key)
                    return entry.translated_text
        return None

    def _remember(self, entry: _CacheEntry) -> None:
        with self._lock:
            self._remember_locked(entry)

    def _remember_locked(self, entry: _CacheEntry) -> None:
        if self.memory_capacity <= 0:
            return
        self._memory[entry.key] = entry
        self._memory.move_to_end(entry.key)
        while len(self._memory) > self.memory_capacity:
            self._memory.popitem(last=False)

    def _enqueue_write(self, entry: _CacheEntry) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("이미 닫힌 번역 캐시에는 저장할 수 없어.")
            self._write_queue.put(entry)

    def _write_worker(self) -> None:
        while True:
            items = [self._write_queue.get()]
            while len(items) < _WRITE_BATCH_SIZE:
                try:
                    items.append(self._write_queue.get_nowait())
                except queue.Empty:
                    break
            should_stop = _WRITE_STOP in items
            entries = [item for item in items if isinstance(item, _CacheEntry)]
            try:
                if entries:
                    self._write_entries(entries)
            except Exception as exc:
                self._write_error = exc
                LOGGER.exception("번역 캐시 비동기 저장 실패")
            finally:
                for _ in items:
                    self._write_queue.task_done()
            if should_stop:
                return

    def _write_entries(self, entries: list[_CacheEntry]) -> None:
        with self._lock, self._connection:
            self._connection.executemany(
                """
                INSERT INTO translations VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_hash, target_language, translator) DO UPDATE SET
                    source_text=excluded.source_text,
                    source_language=excluded.source_language,
                    translated_text=excluded.translated_text,
                    updated_at=excluded.updated_at
                """,
                [
                    (
                        entry.source_hash,
                        entry.source_text,
                        entry.source.value,
                        entry.target.value,
                        entry.translator,
                        entry.translated_text,
                        entry.updated_at,
                    )
                    for entry in entries
                ],
            )


def _normalize_text(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _edit_distance_at_most_one(first: str, second: str) -> bool:
    if abs(len(first) - len(second)) > 1:
        return False
    if len(first) == len(second):
        return sum(left != right for left, right in zip(first, second, strict=True)) <= 1
    shorter, longer = (first, second) if len(first) < len(second) else (second, first)
    short_index = 0
    long_index = 0
    skipped = False
    while short_index < len(shorter) and long_index < len(longer):
        if shorter[short_index] == longer[long_index]:
            short_index += 1
            long_index += 1
            continue
        if skipped:
            return False
        skipped = True
        long_index += 1
    return True
