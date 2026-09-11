//! Completed-message replay and the latest visible work set. Neither lock is
//! held during inference. Persistent bodies use the existing encrypted store.
use super::*;
use sha2::{Digest, Sha256};

const MAX_REPLAY_MESSAGES: usize = 1024;
const MAX_REPLAY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
struct ReplayState {
    namespace: String,
    revision: u64,
    entries: HashMap<String, Vec<String>>,
    order: VecDeque<String>,
    misses: HashSet<String>,
    bytes: usize,
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
    }

    pub fn clear_memory(&self) {
        let mut state = self.state.lock().unwrap();
        state.revision += 1;
        state.entries.clear();
        state.order.clear();
        state.misses.clear();
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
        state.bytes = 0;
        operation()
    }

    pub fn revision(&self) -> u64 {
        self.state.lock().unwrap().revision
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
