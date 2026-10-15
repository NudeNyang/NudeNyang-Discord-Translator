//! Completed-message replay and the latest visible work set. Neither lock is
//! held during inference. Persistent bodies use the existing encrypted store.
use super::*;
use sha2::{Digest, Sha256};

const MAX_REPLAY_MESSAGES: usize = 1024;
const MAX_REPLAY_BYTES: usize = 8 * 1024 * 1024;

struct DisplayFailure {
    attempts: u8,
    retry_at: Option<Instant>,
    error: String,
}

#[derive(Default)]
struct ReplayState {
    namespace: String,
    revision: u64,
    entries: HashMap<String, Vec<String>>,
    order: VecDeque<String>,
    misses: HashSet<String>,
    bytes: usize,
    failures: HashMap<String, DisplayFailure>,
    failure_order: VecDeque<String>,
}

pub(super) struct DisplayReplay {
    store: Option<TranslationCache>,
    state: Mutex<ReplayState>,
    visible: Mutex<HashMap<u64, (u64, u64, HashSet<PendingKey>)>>,
}

impl DisplayReplay {
    pub fn new() -> Self {
        Self {
            store: TranslationCache::open_default().ok(),
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        }
    }

    pub fn activate(&self, namespace: &str) {
        let mut state = self.state.lock().unwrap();
        state.namespace = namespace.to_string();
        state.revision += 1;
        state.failures.clear();
        state.failure_order.clear();
    }

    pub fn clear_memory(&self) {
        let mut state = self.state.lock().unwrap();
        state.revision += 1;
        state.entries.clear();
        state.order.clear();
        state.misses.clear();
        state.failures.clear();
        state.failure_order.clear();
        state.bytes = 0;
    }

    pub fn invalidate<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.state.lock().unwrap();
        state.revision += 1;
        state.entries.clear();
        state.order.clear();
        state.misses.clear();
        state.failures.clear();
        state.failure_order.clear();
        state.bytes = 0;
        operation()
    }

    pub fn revision(&self) -> u64 {
        self.state.lock().unwrap().revision
    }

    fn failure_key(namespace: &str, batch: &TranslationBatch) -> Option<String> {
        // A remount is not a new attempt. Explicit translation/config changes are.
        Self::key(namespace, batch).map(|key| format!("{}:{key}", batch.generation))
    }

    /// One failure bucket per message context. Every range keeps the full batch
    /// metadata so a context keys the same way regardless of render boundaries;
    /// only the aligned `source_hints` and `parts` slices are narrowed. Ranges
    /// are never split further into fragments.
    fn context_batches(batch: &TranslationBatch) -> Vec<TranslationBatch> {
        message_ranges(&batch.parts)
            .into_iter()
            .map(|range| TranslationBatch {
                source_hints: batch
                    .source_hints
                    .as_ref()
                    .map(|hints| hints[range.clone()].to_vec()),
                generation: batch.generation,
                view_epoch: batch.view_epoch,
                view_scope: batch.view_scope.clone(),
                target: batch.target,
                allowed_sources: batch.allowed_sources.clone(),
                parts: batch.parts[range].to_vec(),
                context_scope: batch.context_scope.clone(),
                queued_at: batch.queued_at,
            })
            .collect()
    }

    pub fn take_deferred(
        &self,
        batch: &mut TranslationBatch,
        now: Instant,
    ) -> Vec<(TranslationBatch, String)> {
        let context = Self::context_batches(batch);
        let mut ready_parts = Vec::new();
        let mut ready_hints = batch.source_hints.as_ref().map(|_| Vec::new());
        let mut deferred = Vec::new();
        for context_batch in context {
            if let Some(error) = self.deferred_error(&context_batch, now) {
                deferred.push((context_batch, error));
                continue;
            }
            if let Some(hints) = ready_hints.as_mut() {
                hints.extend(context_batch.source_hints.unwrap_or_default());
            }
            ready_parts.extend(context_batch.parts);
        }
        batch.parts = ready_parts;
        if let Some(hints) = ready_hints {
            batch.source_hints = Some(hints);
        }
        deferred
    }

    pub fn deferred_error(&self, batch: &TranslationBatch, now: Instant) -> Option<String> {
        let state = self.state.lock().unwrap();
        for context in Self::context_batches(batch) {
            let Some(key) = Self::failure_key(&state.namespace, &context) else {
                continue;
            };
            let Some(failure) = state.failures.get(&key) else {
                continue;
            };
            if failure.retry_at.is_some_and(|retry_at| now >= retry_at) {
                continue;
            }
            return Some(failure.error.clone());
        }
        None
    }

    pub fn record_failure(
        &self,
        batch: &TranslationBatch,
        error: &str,
        revision: u64,
        now: Instant,
    ) {
        let mut state = self.state.lock().unwrap();
        if state.revision != revision {
            return;
        }
        for context in Self::context_batches(batch) {
            let Some(key) = Self::failure_key(&state.namespace, &context) else {
                continue;
            };
            let attempts = state
                .failures
                .get(&key)
                .map_or(1, |failure| failure.attempts.saturating_add(1));
            // Quality repair already ran inside the provider. Repeating the entire
            // pipeline cannot distinguish code from an unchanged natural sentence.
            let terminal =
                error.starts_with(crate::translation::QUALITY_REJECTED_ERROR) || attempts >= 3;
            if !state.failures.contains_key(&key) {
                state.failure_order.push_back(key.clone());
            }
            state.failures.insert(
                key,
                DisplayFailure {
                    attempts,
                    retry_at: (!terminal).then(|| now + Duration::from_secs(1 << attempts)),
                    // Bound diagnostics in memory; never persist failed message bodies.
                    error: error.chars().take(1024).collect(),
                },
            );
        }
        while state.failures.len() > MAX_REPLAY_MESSAGES {
            let oldest = state.failure_order.pop_front().unwrap();
            state.failures.remove(&oldest);
        }
    }

    pub fn clear_failure(&self, batch: &TranslationBatch, revision: u64) {
        let mut state = self.state.lock().unwrap();
        if state.revision != revision {
            return;
        }
        for context in Self::context_batches(batch) {
            if let Some(key) = Self::failure_key(&state.namespace, &context) {
                state.failures.remove(&key);
                state.failure_order.retain(|candidate| candidate != &key);
            }
        }
    }

    pub fn observe(&self, generation: u64, epoch: u64, parts: &[DomPart]) {
        self.visible.lock().unwrap().insert(
            generation >> 48,
            (
                generation,
                epoch,
                parts
                    .iter()
                    .map(|part| pending_key(generation, epoch, part))
                    .collect(),
            ),
        );
    }

    pub fn retain_visible(&self, batch: &mut TranslationBatch) {
        let visible = self.visible.lock().unwrap();
        let Some((generation, epoch, keys)) = visible.get(&(batch.generation >> 48)) else {
            return;
        };
        // Keep an entire message context or drop it; never change its fragment set.
        let mut keep = Vec::new();
        for range in message_ranges(&batch.parts) {
            if *generation == batch.generation
                && *epoch == batch.view_epoch
                && batch.parts[range.clone()].iter().all(|part| {
                    keys.contains(&pending_key(batch.generation, batch.view_epoch, part))
                })
            {
                keep.extend(range);
            }
        }
        if let Some(hints) = batch.source_hints.as_mut() {
            *hints = keep.iter().map(|index| hints[*index]).collect();
        }
        batch.parts = keep
            .into_iter()
            .map(|index| batch.parts[index].clone())
            .collect();
    }

    fn key(namespace: &str, batch: &TranslationBatch) -> Option<String> {
        if namespace.is_empty() || batch.parts.is_empty() {
            return None;
        }
        let mut allowed = batch.allowed_sources.as_ref().map(|languages| {
            languages
                .iter()
                .map(|language| language.code())
                .collect::<Vec<_>>()
        });
        if let Some(allowed) = allowed.as_mut() {
            allowed.sort_unstable();
        }
        let parts = batch
            .parts
            .iter()
            .map(|part| {
                (
                    &part.kind,
                    incoming_context_key(part),
                    part.index,
                    &part.text,
                )
            })
            .collect::<Vec<_>>();
        let encoded = serde_json::to_vec(&(
            "discord-replay-v1",
            namespace,
            &batch.view_scope,
            batch.target.code(),
            allowed,
            parts,
        ))
        .ok()?;
        Some(format!("{:x}", Sha256::digest(encoded)))
    }

    pub fn lookup(&self, batch: &TranslationBatch) -> Option<Vec<String>> {
        let mut state = self.state.lock().unwrap();
        // Partial quality failures are completed attempts for this configuration,
        // but must never enter the persistent successful-translation cache.
        let contexts = Self::context_batches(batch);
        let attempted = contexts
            .iter()
            .map(|context| {
                let key = Self::quality_attempt_key(&state, context)?;
                state.entries.get(&key).cloned()
            })
            .collect::<Option<Vec<_>>>();
        if let Some(attempted) = attempted {
            return Some(attempted.into_iter().flatten().collect());
        }
        let key = Self::key(&state.namespace, batch)?;
        if let Some(values) = state.entries.get(&key) {
            return Some(values.clone());
        }
        if state.misses.contains(&key) {
            return None;
        }
        let Some(encoded) = self.store.as_ref()?.display_replay(&key).ok()? else {
            if state.misses.len() >= MAX_REPLAY_MESSAGES {
                state.misses.clear();
            }
            state.misses.insert(key);
            return None;
        };
        let values: Vec<String> = serde_json::from_str(&encoded).ok()?;
        if values.len() != batch.parts.len() {
            return None;
        }
        Self::remember(&mut state, key, values.clone());
        Some(values)
    }

    fn quality_attempt_key(state: &ReplayState, batch: &TranslationBatch) -> Option<String> {
        Self::key(&state.namespace, batch).map(|key| {
            format!(
                "quality-attempt:{}:{}:{key}",
                state.revision, batch.generation
            )
        })
    }

    pub fn record_translation(
        &self,
        batch: &TranslationBatch,
        parts: &[crate::translation::TranslationPart],
        revision: u64,
    ) {
        if parts.len() != batch.parts.len() {
            return;
        }
        self.clear_failure(batch, revision);
        let mut offset = 0;
        for context in Self::context_batches(batch) {
            let outcome = &parts[offset..offset + context.parts.len()];
            offset += context.parts.len();
            let values = outcome
                .iter()
                .map(|part| part.text.clone())
                .collect::<Vec<_>>();
            if outcome.iter().any(|part| part.quality_rejected) {
                let mut state = self.state.lock().unwrap();
                if state.revision != revision {
                    return;
                }
                if let Some(key) = Self::quality_attempt_key(&state, &context) {
                    // Same bounded memory budget as normal replay. Explicit retry,
                    // edits, model/target changes and history deletion invalidate it.
                    Self::remember(&mut state, key, values);
                }
            } else {
                self.store(&context, &values, revision);
            }
        }
    }

    pub fn store(&self, batch: &TranslationBatch, values: &[String], revision: u64) {
        // Do not freeze a failed/filtered/unknown-language passthrough as a final
        // translation. Normal translation cache remains the fallback in that case.
        if values.len() != batch.parts.len()
            || !values
                .iter()
                .zip(&batch.parts)
                .any(|(value, part)| value != &part.text)
            || values.iter().zip(&batch.parts).any(|(value, part)| {
                value == &part.text
                    && part.text.chars().any(char::is_alphabetic)
                    && crate::translation::protected_text::protect_text(&part.text)
                        .has_translatable_text()
            })
        {
            return;
        }
        let mut state = self.state.lock().unwrap();
        if revision != state.revision {
            return;
        }
        let Some(key) = Self::key(&state.namespace, batch) else {
            return;
        };
        if let Some(store) = &self.store {
            if let Ok(encoded) = serde_json::to_string(values) {
                if let Err(error) = store.put_display_replay(&key, &encoded) {
                    crate::diagnostics::warn("display-replay", &error);
                }
            }
        }
        Self::remember(&mut state, key, values.to_vec());
    }

    fn remember(state: &mut ReplayState, key: String, values: Vec<String>) {
        fn size(key: &str, values: &[String]) -> usize {
            key.len() * 2 + values.iter().map(String::len).sum::<usize>()
        }
        state.misses.remove(&key);
        if let Some(previous) = state.entries.remove(&key) {
            state.bytes -= size(&key, &previous);
        } else {
            state.order.push_back(key.clone());
        }
        state.bytes += size(&key, &values);
        state.entries.insert(key, values);
        while state.entries.len() > MAX_REPLAY_MESSAGES || state.bytes > MAX_REPLAY_BYTES {
            let key = state.order.pop_front().unwrap();
            let values = state.entries.remove(&key).unwrap();
            state.bytes -= size(&key, &values);
        }
    }
}

pub(super) fn pending_key(generation: u64, epoch: u64, part: &DomPart) -> PendingKey {
    (
        generation,
        epoch,
        part.kind.clone(),
        part.item_id.clone(),
        part.index,
        part.text.clone(),
    )
}

pub(super) fn coalesce_message_contexts(parts: Vec<DomPart>) -> Vec<DomPart> {
    let mut indices = HashMap::new();
    let mut groups: Vec<Vec<DomPart>> = Vec::new();
    for part in parts {
        let index = display_message_context(&part)
            .map(|key| {
                *indices.entry(key).or_insert_with(|| {
                    groups.push(Vec::new());
                    groups.len() - 1
                })
            })
            .unwrap_or_else(|| {
                groups.push(Vec::new());
                groups.len() - 1
            });
        groups[index].push(part);
    }
    groups.into_iter().flatten().collect()
}

pub(super) fn message_ranges(parts: &[DomPart]) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < parts.len() {
        let key = display_message_context(&parts[start]);
        let mut end = start + 1;
        while key.is_some() && end < parts.len() && display_message_context(&parts[end]) == key {
            end += 1;
        }
        ranges.push(start..end);
        start = end;
    }
    ranges
}

fn display_message_context(part: &DomPart) -> Option<String> {
    // Navigation language evidence is shared, but independent labels must not
    // become one all-or-nothing message or wait for an entire sidebar.
    matches!(part.kind.as_str(), "message" | "reply" | "embed")
        .then(|| incoming_context_key(part))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch() -> TranslationBatch {
        TranslationBatch {
            source_hints: None,
            generation: 1,
            view_epoch: 1,
            view_scope: "/channels/guild/channel".into(),
            context_scope: "/channels/guild/channel".into(),
            target: Language::Korean,
            allowed_sources: None,
            queued_at: Instant::now(),
            parts: vec![DomPart {
                kind: "message".into(),
                item_id: "element-1".into(),
                context_id: Some("stable-message-1".into()),
                index: 0,
                text: "Hello @everyone 👋".into(),
                displayed_text: None,
            }],
        }
    }

    #[test]
    fn partial_quality_attempt_replays_without_persisting_or_blocking_explicit_retry() {
        let replay = DisplayReplay {
            store: None,
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        };
        replay.activate("partial-quality-test");
        let mut request = batch();
        let mut fragment = request.parts[0].clone();
        fragment.index += 1;
        fragment.text = "Still untranslated".into();
        request.parts.push(fragment);
        let values = vec![
            crate::translation::TranslationPart::from("번역된 부분".to_string()),
            crate::translation::TranslationPart {
                text: "Still untranslated".into(),
                quality_rejected: true,
            },
        ];
        let revision = replay.revision();
        replay.record_translation(&request, &values, revision);
        request.view_epoch += 1;
        assert_eq!(
            replay.lookup(&request),
            Some(vec!["번역된 부분".into(), "Still untranslated".into()])
        );
        assert!(replay.deferred_error(&request, Instant::now()).is_none());
        let key = DisplayReplay::key("partial-quality-test", &request).unwrap();
        assert!(!replay.state.lock().unwrap().entries.contains_key(&key));
        request.generation += 1;
        assert!(replay.lookup(&request).is_none());
        request.generation -= 1;
        request.parts[1].text = "Edited message".into();
        assert!(replay.lookup(&request).is_none());
        request.parts[1].text = "Still untranslated".into();
        replay.activate("partial-quality-test");
        assert!(replay.lookup(&request).is_none());
        replay.record_translation(&request, &values, revision);
        assert!(
            replay.lookup(&request).is_none(),
            "stale worker cannot resurrect an attempt"
        );
    }

    #[test]
    fn codebuddy_deferred_context_keeps_neighbor_and_hints() {
        let replay = DisplayReplay {
            store: None,
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        };
        replay.activate("codebuddy-hints-test");

        let mut failed = batch();
        let mut second = failed.parts[0].clone();
        second.index = 1;
        second.text = "Second fragment".to_string();
        failed.parts.push(second);

        let now = Instant::now();
        replay.record_failure(
            &failed,
            crate::translation::QUALITY_REJECTED_ERROR,
            replay.revision(),
            now,
        );

        let mut pending = batch();
        pending.parts = failed.parts.clone();
        let mut neighbor = pending.parts[0].clone();
        neighbor.context_id = Some("neighbor".to_string());
        neighbor.item_id = "neighbor".to_string();
        neighbor.index = 0;
        neighbor.text = "Neighbor".to_string();
        pending.parts.push(neighbor);
        pending.source_hints = Some(vec![
            Some(crate::language::Language::English),
            Some(crate::language::Language::English),
            Some(crate::language::Language::Japanese),
        ]);

        let deferred = replay.take_deferred(&mut pending, now);

        assert_eq!(deferred.len(), 1);
        assert_eq!(deferred[0].0.parts.len(), 2);
        assert_eq!(
            deferred[0].0.source_hints,
            Some(vec![
                Some(crate::language::Language::English),
                Some(crate::language::Language::English),
            ])
        );
        assert_eq!(deferred[0].1, crate::translation::QUALITY_REJECTED_ERROR);

        assert_eq!(pending.parts.len(), 1);
        assert_eq!(pending.parts[0].text, "Neighbor");
        assert_eq!(
            pending.source_hints,
            Some(vec![Some(crate::language::Language::Japanese)])
        );
        assert_eq!(pending.generation, 1);
        assert_eq!(pending.view_scope, "/channels/guild/channel");
    }

    #[test]
    fn codebuddy_batched_failure_is_visible_to_single_message() {
        let replay = DisplayReplay {
            store: None,
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        };
        replay.activate("codebuddy-budget-test");

        let now = Instant::now();
        let revision = replay.revision();

        let original = batch();
        let mut mixed = batch();

        let mut neighbor = original.parts[0].clone();
        neighbor.context_id = Some("neighbor".to_string());
        neighbor.item_id = "neighbor".to_string();
        neighbor.text = "Another English message".to_string();
        mixed.parts.push(neighbor);

        replay.record_failure(
            &mixed,
            crate::translation::QUALITY_REJECTED_ERROR,
            revision,
            now,
        );
        assert!(replay.deferred_error(&original, now).is_some());

        mixed.parts[1].context_id = Some("neighbor-updated".to_string());
        mixed.parts[1].text = "A changed English message".to_string();

        assert!(replay.deferred_error(&original, now).is_some());

        let mut changed_neighbor = batch();
        changed_neighbor.parts = vec![mixed.parts[1].clone()];
        assert!(replay.deferred_error(&changed_neighbor, now).is_none());
    }

    #[test]
    fn codebuddy_batched_transport_budget_survives_neighbors() {
        let replay = DisplayReplay {
            store: None,
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        };
        replay.activate("codebuddy-budget-test");

        let now = Instant::now();
        let revision = replay.revision();

        let mut mixed = batch();
        let mut neighbor = batch().parts[0].clone();
        neighbor.context_id = Some("neighbor".to_string());
        neighbor.item_id = "neighbor".to_string();
        neighbor.text = "Another English message".to_string();
        mixed.parts.push(neighbor);

        replay.record_failure(&mixed, "server unavailable", revision, now);
        replay.record_failure(
            &mixed,
            "server unavailable",
            revision,
            now + Duration::from_secs(2),
        );
        replay.record_failure(
            &mixed,
            "server unavailable",
            revision,
            now + Duration::from_secs(6),
        );

        let single_a = batch();
        let mut single_b = batch();
        single_b.parts = vec![mixed.parts[1].clone()];

        let later = now + Duration::from_secs(3600);
        assert!(replay.deferred_error(&single_a, later).is_some());
        assert!(replay.deferred_error(&single_b, later).is_some());

        replay.clear_failure(&single_b, revision);
        assert!(replay.deferred_error(&single_b, later).is_none());
        assert!(replay.deferred_error(&single_a, later).is_some());

        replay.clear_failure(&single_a, revision);
        assert!(replay.deferred_error(&single_a, later).is_none());
    }

    #[test]
    fn quality_failure_survives_remount_but_not_edits_or_explicit_retry() {
        let replay = DisplayReplay {
            store: None,
            state: Mutex::new(ReplayState::default()),
            visible: Mutex::new(HashMap::new()),
        };
        replay.activate("retry-test");
        let original = batch();
        let now = Instant::now();
        replay.record_failure(
            &original,
            crate::translation::QUALITY_REJECTED_ERROR,
            replay.revision(),
            now,
        );
        let mut remount = batch();
        remount.view_epoch += 1;
        remount.parts[0].item_id = "remounted".into();
        assert!(replay
            .deferred_error(&remount, now + Duration::from_secs(3600))
            .is_some());
        assert!(
            replay.lookup(&original).is_none(),
            "failure must not enter translation cache"
        );
        let mut edit = batch();
        edit.parts[0].text.push_str(" changed");
        assert!(replay.deferred_error(&edit, now).is_none());
        let mut retry = batch();
        retry.generation += 1;
        assert!(replay.deferred_error(&retry, now).is_none());
        let mut other = batch();
        other.view_scope.push_str("other-channel");
        assert!(replay.deferred_error(&other, now).is_none());
        other = batch();
        other.target = Language::Japanese;
        assert!(replay.deferred_error(&other, now).is_none());
        replay.activate("other-provider");
        assert!(replay.deferred_error(&original, now).is_none());
    }

    #[test]
    fn transient_failure_backs_off_and_stops_after_three_attempts() {
        let replay = DisplayReplay::new();
        replay.activate("retry-test");
        let batch = batch();
        let now = Instant::now();
        let revision = replay.revision();
        replay.record_failure(&batch, "server unavailable", revision, now);
        assert!(replay
            .deferred_error(&batch, now + Duration::from_secs(1))
            .is_some());
        assert!(replay
            .deferred_error(&batch, now + Duration::from_secs(2))
            .is_none());
        replay.record_failure(
            &batch,
            "server unavailable",
            revision,
            now + Duration::from_secs(2),
        );
        assert!(replay
            .deferred_error(&batch, now + Duration::from_secs(5))
            .is_some());
        assert!(replay
            .deferred_error(&batch, now + Duration::from_secs(6))
            .is_none());
        replay.record_failure(
            &batch,
            "server unavailable",
            revision,
            now + Duration::from_secs(6),
        );
        assert!(replay
            .deferred_error(&batch, now + Duration::from_secs(3600))
            .is_some());
        replay.clear_failure(&batch, revision);
        assert!(replay.deferred_error(&batch, now).is_none());
        replay.clear_memory();
        replay.record_failure(&batch, "late failure", revision, now);
        assert!(replay.deferred_error(&batch, now).is_none());
    }

    #[test]
    fn failure_memory_is_bounded_and_cleared_with_cache() {
        let replay = DisplayReplay::new();
        replay.activate("retry-test");
        let mut batch = batch();
        for index in 0..MAX_REPLAY_MESSAGES + 20 {
            batch.parts[0].context_id = Some(format!("message-{index}"));
            replay.record_failure(
                &batch,
                "x".repeat(2000).as_str(),
                replay.revision(),
                Instant::now(),
            );
        }
        {
            let state = replay.state.lock().unwrap();
            assert_eq!(state.failures.len(), MAX_REPLAY_MESSAGES);
            assert_eq!(state.failure_order.len(), MAX_REPLAY_MESSAGES);
            assert!(state
                .failures
                .values()
                .all(|failure| failure.error.len() == 1024));
        }
        replay.invalidate(|| Ok(())).unwrap();
        assert!(replay.deferred_error(&batch, Instant::now()).is_none());
    }

    #[test]
    fn replay_survives_remount_and_memory_eviction_without_crossing_boundaries() {
        let replay = DisplayReplay::new();
        replay.activate("model:prompt-v1");
        let mut batch = batch();
        let values = vec!["안녕하세요 @everyone 👋".to_string()];
        replay.store(&batch, &values, replay.revision());
        batch.parts[0].item_id = "replacement-element".into();
        assert_eq!(replay.lookup(&batch), Some(values.clone()));
        replay.clear_memory(); // Exercises the independent database path.
        assert_eq!(replay.lookup(&batch), Some(values.clone()));
        batch.parts[0].text.push_str(" edited");
        assert!(replay.lookup(&batch).is_none());
        batch.parts[0].text = "Hello @everyone 👋".into();
        batch.target = Language::Japanese;
        assert!(replay.lookup(&batch).is_none());
        batch.target = Language::Korean;
        batch.allowed_sources = Some(HashSet::from([Language::Japanese]));
        assert!(replay.lookup(&batch).is_none());
        batch.allowed_sources = None;
        batch.view_scope.push_str("-other");
        assert!(replay.lookup(&batch).is_none());
        batch.view_scope = "/channels/guild/channel".into();
        batch.parts[0].context_id = Some("different-message".into());
        assert!(replay.lookup(&batch).is_none());
        batch.parts[0].context_id = Some("stable-message-1".into());
        replay.activate("model:prompt-v2");
        assert!(replay.lookup(&batch).is_none());
        replay.activate("model:prompt-v1");
        assert_eq!(replay.lookup(&batch), Some(values));
    }

    #[test]
    fn replay_clear_rejects_inflight_results_and_removes_persistent_bodies() {
        let replay = DisplayReplay::new();
        replay.activate("test:v1");
        let batch = batch();
        let values = vec!["안녕하세요 @everyone 👋".to_string()];
        let revision = replay.revision();
        replay.store(&batch, &values, revision);
        replay
            .invalidate(|| replay.store.as_ref().unwrap().clear_user_data())
            .unwrap();
        replay.store(&batch, &values, revision);
        assert!(replay.lookup(&batch).is_none());
        replay.store(&batch, &[batch.parts[0].text.clone()], replay.revision());
        assert!(replay.lookup(&batch).is_none());
    }

    #[test]
    fn replay_memory_is_bounded_by_message_count_and_bytes() {
        let mut state = ReplayState::default();
        for index in 0..MAX_REPLAY_MESSAGES + 1 {
            DisplayReplay::remember(&mut state, index.to_string(), vec!["result".into()]);
        }
        assert_eq!(state.entries.len(), MAX_REPLAY_MESSAGES);
        assert_eq!(state.order.front().unwrap(), "1");
        DisplayReplay::remember(
            &mut state,
            "oversized".into(),
            vec!["x".repeat(MAX_REPLAY_BYTES)],
        );
        assert!(state.entries.is_empty());
        assert_eq!(state.bytes, 0);
    }

    #[test]
    fn visible_work_keeps_whole_contexts_and_isolates_discord_variants() {
        let replay = DisplayReplay::new();
        let mut batch = batch();
        let mut fragment = batch.parts[0].clone();
        fragment.index = 1;
        fragment.text = "A second sentence.".into();
        batch.parts.push(fragment);
        batch.source_hints = Some(vec![None, Some(Language::English)]);
        replay.observe(1 << 48, 3, &[]); // Another release cannot discard this work.
        replay.retain_visible(&mut batch);
        assert_eq!(batch.parts.len(), 2);
        replay.observe(batch.generation, batch.view_epoch, &batch.parts[..1]);
        replay.retain_visible(&mut batch);
        assert!(batch.parts.is_empty());
        assert!(batch.source_hints.unwrap().is_empty());
    }

    #[test]
    fn nonadjacent_fragments_keep_their_message_context_and_relative_order() {
        let first = batch().parts.remove(0);
        let mut other = first.clone();
        other.context_id = Some("other-message".into());
        let mut last = first.clone();
        last.index = 1;
        let parts = coalesce_message_contexts(vec![first, other, last]);
        assert_eq!(message_ranges(&parts), vec![0..2, 2..3]);
        assert_eq!(parts[0].index, 0);
        assert_eq!(parts[1].index, 1);
        assert_eq!(parts[2].context_id.as_deref(), Some("other-message"));
    }

    #[test]
    fn navigation_language_evidence_does_not_bundle_independent_labels() {
        let mut first = batch().parts.remove(0);
        first.kind = "channel".into();
        let mut second = first.clone();
        second.item_id = "another-channel".into();
        let parts = coalesce_message_contexts(vec![first, second]);
        assert_eq!(message_ranges(&parts), vec![0..1, 1..2]);
    }
}
