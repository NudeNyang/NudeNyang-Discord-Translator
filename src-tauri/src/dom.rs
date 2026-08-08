use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SNAPSHOT_SCRIPT: &str = r#"
(() => {
  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  }
  function eligibleTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedParent = parent.closest(
        'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input'
      );
      if (protectedParent && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }
    return nodes;
  }
  function ensureRootId(root, attribute, prefix) {
    let id = root.getAttribute(attribute);
    if (!id || !id.startsWith(`dto-${prefix}-`)) {
      window.__dtoRootSequence = (window.__dtoRootSequence || 0) + 1;
      id = `dto-${prefix}-${window.__dtoRootSequence}`;
      root.setAttribute(attribute, id);
    }
    return id;
  }
  function channelVisual(root) {
    return root.querySelector(
      'div[aria-hidden="true"] > span,' +
      '[class*="name__"][aria-hidden="true"] > div'
    );
  }
  function parts(kind, id, root) {
    return eligibleTextNodes(root).map((node, index) => ({
      kind, id, index, text: node.nodeValue,
    }));
  }

  const out = [];
  for (const root of document.querySelectorAll('[id^="message-content-"]')) {
    if (root.closest('[id^="message-reply-context-"]')) continue;
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-message-id', 'message');
    out.push(...parts('message', id, root));
  }
  for (const context of document.querySelectorAll('[id^="message-reply-context-"]')) {
    if (!isVisible(context)) continue;
    const root = context.querySelector('[class*="repliedTextPreview"] [id^="message-content-"]');
    if (!root) continue;
    const id = ensureRootId(root, 'data-dto-reply-id', 'reply');
    out.push(...parts('reply', id, root));
  }
  const embedSelector = [
    '[class*="embedTitle_"]', '[class*="embedDescription_"]',
    '[class*="embedFieldName_"]', '[class*="embedFieldValue_"]'
  ].join(',');
  for (const root of document.querySelectorAll(embedSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-root-id', 'embed');
    out.push(...parts('embed', id, root));
  }
  for (const channel of document.querySelectorAll('[data-list-item-id^="channels___"]')) {
    if (!isVisible(channel)) continue;
    const visual = channelVisual(channel);
    const itemId = channel.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({kind: 'channel', id: itemId, index: 0, text: visual.textContent});
    }
  }
  for (const category of document.querySelectorAll(
    '[data-list-item-id^="channels___"][role="button"][aria-label$="(카테고리)"]'
  )) {
    if (!isVisible(category)) continue;
    const visual = category.querySelector('h3 > div');
    const itemId = category.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({kind: 'category', id: itemId, index: 0, text: visual.textContent});
    }
  }
  for (const root of document.querySelectorAll('[class*="postTitleText"]')) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-forum-title-id', 'forum-title');
    out.push(...parts('forum-title', id, root));
  }
  const headingSelector = [
    'h1[class*="title__"]',
    'h2[class*="title__"]',
    'h3[aria-hidden="true"][data-text-variant^="heading-"]'
  ].join(',');
  for (const root of document.querySelectorAll(headingSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-heading-id', 'heading');
    out.push(...parts('heading', id, root));
  }
  const contextSelector = [
    '[class*="guildDropdown_"] h2',
    '[class*="topic_"][class*="expandable_"]',
    'div[id^="chat-messages-"][class*="container_"] > div[class*="description_"]',
    '[role="dialog"] [class*="headerSubtitle_"]',
    '[role="dialog"] main[class*="bodyInner_"] [class*="markup_"]'
  ].join(',');
  for (const root of document.querySelectorAll(contextSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-context-id', 'context');
    out.push(...parts('context', id, root));
  }
  return {url: location.href, title: document.title, parts: out};
})()
"#;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct DomPart {
    pub kind: String,
    #[serde(rename = "id")]
    pub item_id: String,
    pub index: usize,
    pub text: String,
}

impl DomPart {
    pub fn locator(&self) -> (String, String, usize) {
        (self.kind.clone(), self.item_id.clone(), self.index)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct DomSnapshot {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub parts: Vec<DomPart>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DomChange {
    pub kind: String,
    pub id: String,
    pub index: usize,
    pub text: String,
}

impl DomChange {
    pub fn new(part: &DomPart, text: impl Into<String>) -> Self {
        Self {
            kind: part.kind.clone(),
            id: part.item_id.clone(),
            index: part.index,
            text: text.into(),
        }
    }
}

pub fn parse_snapshot(value: Value) -> Result<DomSnapshot, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Discord DOM 스냅샷을 읽지 못했어: {error}"))
}

pub fn apply_script(changes: &[DomChange]) -> Result<String, String> {
    let encoded = serde_json::to_string(changes)
        .map_err(|error| format!("DOM 번역 변경 목록을 만들지 못했어: {error}"))?;
    Ok(format!(
        r#"
(() => {{
  const changes = {encoded};
  function eligibleTextNodes(root) {{
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {{
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedParent = parent.closest(
        'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input'
      );
      if (protectedParent && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }}
    return nodes;
  }}
  let applied = 0;
  for (const change of changes) {{
    let root = null;
    if (change.kind === 'message') root = document.querySelector(
      `[data-dto-message-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'reply') root = document.querySelector(
      `[data-dto-reply-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'embed') root = document.querySelector(
      `[data-dto-root-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'forum-title') root = document.querySelector(
      `[data-dto-forum-title-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'heading') root = document.querySelector(
      `[data-dto-heading-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'context') root = document.querySelector(
      `[data-dto-context-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'channel') {{
      const channel = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"]`
      );
      root = channel?.querySelector(
        'div[aria-hidden="true"] > span,' +
        '[class*="name__"][aria-hidden="true"] > div'
      ) || null;
      if (root) {{ root.textContent = change.text; applied++; continue; }}
    }}
    else if (change.kind === 'category') {{
      const category = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"][role="button"]`
      );
      root = category?.querySelector('h3 > div') || null;
      if (root) {{ root.textContent = change.text; applied++; continue; }}
    }}
    if (!root) continue;
    const nodes = eligibleTextNodes(root);
    const node = nodes[change.index];
    if (!node) continue;
    node.nodeValue = change.text;
    applied++;
  }}
  return {{applied}};
}})()
"#
    ))
}

#[cfg(test)]
mod tests {
    use super::{apply_script, parse_snapshot, DomChange, DomPart, SNAPSHOT_SCRIPT};
    use serde_json::json;

    #[test]
    fn snapshot_payload_preserves_locator_and_text() {
        let snapshot = parse_snapshot(json!({
            "url": "https://discord.com/channels/1/2",
            "title": "Discord",
            "parts": [{"kind": "message", "id": "dto-message-1", "index": 2, "text": "hello"}]
        }))
        .unwrap();
        assert_eq!(
            snapshot.parts[0].locator(),
            ("message".into(), "dto-message-1".into(), 2)
        );
        assert!(SNAPSHOT_SCRIPT.contains("message-reply-context-"));
        assert!(SNAPSHOT_SCRIPT.contains("postTitleText"));
    }

    #[test]
    fn changes_are_json_encoded_without_script_injection() {
        let part = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-1".to_string(),
            index: 0,
            text: "original".to_string(),
        };
        let script = apply_script(&[DomChange::new(&part, "` ${alert(1)} \"번역\"")]).unwrap();
        assert!(script.contains(r#""text":"` ${alert(1)} \"번역\"""#));
        assert!(script.contains("CSS.escape(change.id)"));
    }
}
