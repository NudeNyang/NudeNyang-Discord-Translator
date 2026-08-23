use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SNAPSHOT_SCRIPT: &str = r#"
(() => {
  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  }
  function isRendered(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function eligibleTextNodes(root, allowLinkText = false) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedSelector = allowLinkText
        ? 'code,pre,[contenteditable="true"],textarea,input'
        : 'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input';
      const protectedParent = parent.closest(
        protectedSelector
      );
      if (protectedParent && protectedParent !== root && root.contains(protectedParent)) continue;
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
  function canonicalOriginal(kind, id, index, node) {
    const displayed = node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent;
    const originals = window.__nudeTranslatorOriginals;
    if (originals instanceof Map && originals.has(node)) {
      const original = originals.get(node);
      if (typeof original === 'string') return original;
    }
    const locators = window.__nudeTranslatorOriginalsByLocator;
    const stored = locators instanceof Map
      ? locators.get(JSON.stringify([kind, id, index]))
      : null;
    return typeof stored?.text === 'string' ? stored.text : displayed;
  }
  function parts(kind, id, root, allowLinkText = false, contextId = null) {
    return eligibleTextNodes(root, allowLinkText).map((node, index) => ({
      kind,
      id,
      contextId,
      index,
      text: canonicalOriginal(kind, id, index, node),
      displayedText: node.nodeValue,
    }));
  }
  function messageRootCandidates() {
    const roots = new Set(document.querySelectorAll(
      '[id^="message-content-"],[id^="message-content_"]'
    ));
    const rowSelector = [
      '[id^="chat-messages-"]',
      '[data-list-item-id^="chat-messages___"]'
    ].join(',');
    for (const row of document.querySelectorAll(rowSelector)) {
      for (const root of row.querySelectorAll('[class*="messageContent_"]')) {
        roots.add(root);
      }
    }
    return [...roots];
  }
  function isOutgoingMessage(root) {
    if (root.getAttribute('data-nt-outgoing-original') === 'true') return true;
    const manager = window.__nudeTranslatorOutgoingOriginalDisplay;
    if (!(manager?.records instanceof Map)) return false;
    const prefix = 'message-content-';
    if (!root.id?.startsWith(prefix)) return false;
    const messageId = root.id.slice(prefix.length);
    const channel = location.pathname.startsWith('/channels/') ? location.pathname : '';
    return Boolean(channel && messageId && manager.records.has(`${channel}|${messageId}`));
  }

  const out = [];
  for (const root of messageRootCandidates()) {
    if (root.closest('[id^="message-reply-context-"]')) continue;
    if (isOutgoingMessage(root)) continue;
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-message-id', 'message');
    out.push(...parts('message', id, root, false, messageContextId(root)));
  }
  for (const context of document.querySelectorAll('[id^="message-reply-context-"]')) {
    if (!isVisible(context)) continue;
    const root = context.querySelector(
      '[class*="repliedTextPreview"] [id^="message-content-"],' +
      '[class*="repliedTextPreview"] [id^="message-content_"],' +
      '[class*="repliedTextPreview"] [class*="messageContent_"]'
    );
    if (!root) continue;
    const id = ensureRootId(root, 'data-dto-reply-id', 'reply');
    out.push(...parts('reply', id, root));
  }
  const nicknameRoots = new Set(document.querySelectorAll('[id^="message-username-"]'));
  for (const row of document.querySelectorAll(
    '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]'
  )) {
    for (const root of row.querySelectorAll('[class*="username_"]')) nicknameRoots.add(root);
  }
  for (const root of nicknameRoots) {
    if (!isVisible(root) || !root.textContent?.trim()) continue;
    if (root.closest('[class*="embed_"]')) continue;
    const id = ensureRootId(root, 'data-dto-nickname-id', 'nickname');
    out.push(...parts('nickname', id, root));
  }
  const embedContainerSelector = [
    'article[class*="embed_"]',
    '[class*="embedFull_"]',
    '[class*="embedWrapper_"]'
  ].join(',');
  const embedPartSelector = [
    '[class*="embedTitle_"]', '[class*="embedDescription_"]',
    '[class*="embedFieldName_"]', '[class*="embedFieldValue_"]',
    '[class*="embedAuthorName_"]', '[class*="embedFooterText_"]'
  ].join(',');
  function outerEmbedRoot(element) {
    let root = element;
    for (let current = element; current; current = current.parentElement) {
      if (current.matches?.(embedContainerSelector)) root = current;
    }
    return root;
  }
  const embedRoots = new Set();
  for (const root of document.querySelectorAll(embedContainerSelector)) {
    embedRoots.add(outerEmbedRoot(root));
  }
  for (const part of document.querySelectorAll(embedPartSelector)) {
    embedRoots.add(outerEmbedRoot(part));
  }
  function invitePreviewDescriptionRoots() {
    const roots = new Set();
    const inviteAnchors = document.querySelectorAll(
      'a[href*="discord.gg/"],a[href*="discord.com/invite/"]'
    );
    const descriptionSelector = [
      '[class*="guildDescription_"]',
      '[class*="inviteDescription_"]',
      '[class*="description_"]'
    ].join(',');
    for (const anchor of inviteAnchors) {
      const row = anchor.closest(
        '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]'
      );
      if (!row) continue;
      for (const root of row.querySelectorAll(descriptionSelector)) {
        if (!isVisible(root) || !root.textContent?.trim()) continue;
        if (root.closest(
          '[id^="message-content-"],[id^="message-content_"],' +
          '[data-nt-invite-inline-assist],[data-nt-invite-browser-assist]'
        )) continue;
        if (root.closest('a,button,[role="button"]')) continue;
        if (root.closest(embedContainerSelector)) continue;
        roots.add(root);
      }
    }
    return roots;
  }
  for (const root of invitePreviewDescriptionRoots()) {
    embedRoots.add(root);
  }
  for (const root of embedRoots) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-root-id', 'embed');
    out.push(...parts('embed', id, root, true));
  }
  for (const channel of document.querySelectorAll('[data-list-item-id^="channels___"]')) {
    if (!isVisible(channel)) continue;
    const visual = channelVisual(channel);
    const itemId = channel.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({
        kind: 'channel', id: itemId, index: 0,
        text: canonicalOriginal('channel', itemId, 0, visual),
        displayedText: visual.textContent,
      });
    }
  }
  for (const category of document.querySelectorAll(
    '[data-list-item-id^="channels___"][role="button"]'
  )) {
    if (!isVisible(category)) continue;
    const visual = category.querySelector('h3 > div');
    const itemId = category.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({
        kind: 'category', id: itemId, index: 0,
        text: canonicalOriginal('category', itemId, 0, visual),
        displayedText: visual.textContent,
      });
    }
  }
  const forumTitleSelector = [
    '[class*="postTitleText"]',
    'li[class*="container_"][class*="card_"] h3[class*="title__"]'
  ].join(',');
  for (const root of document.querySelectorAll(forumTitleSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-forum-title-id', 'forum-title');
    out.push(...parts('forum-title', id, root));
  }
  const forumTagSelector = [
    '[data-list-item-id*="-tags-navigator___forum-tag-"]',
    '[class*="tagPill__"]'
  ].join(',');
  for (const root of document.querySelectorAll(forumTagSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-forum-tag-id', 'forum-tag');
    out.push(...parts('forum-tag', id, root));
  }
  const headingSelector = [
    'h1[class*="title__"]',
    'h2[class*="title__"]',
    'h3[aria-hidden="true"][data-text-variant^="heading-"]'
  ].join(',');
  for (const root of document.querySelectorAll(headingSelector)) {
    if (!isVisible(root)) continue;
    if (root.closest('[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]')) continue;
    const id = ensureRootId(root, 'data-dto-heading-id', 'heading');
    out.push(...parts('heading', id, root));
  }
  function closestSupplementalSurface(seed) {
    const minimumWidth = Math.min(480, innerWidth * 0.45);
    const minimumHeight = Math.min(360, innerHeight * 0.42);
    for (let current = seed?.parentElement; current && current !== document.body; current = current.parentElement) {
      if (!isRendered(current)) continue;
      const rect = current.getBoundingClientRect();
      if (rect.width < minimumWidth || rect.height < minimumHeight) continue;
      const fillsViewport = rect.width >= innerWidth * 0.98 && rect.height >= innerHeight * 0.98;
      if (!fillsViewport && current.id !== 'app-mount') return current;
    }
    return null;
  }
  function addTextParents(surface, roots, allowControlText = false) {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue?.trim()) continue;
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) continue;
      if (parent.closest(
        '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"],' +
        '[contenteditable="true"],textarea,input,code,pre,[aria-hidden="true"]'
      )) continue;
      if (!allowControlText && parent.closest('a,button,[role="button"]')) continue;
      roots.add(parent);
    }
  }
  function choiceQuestionnaireSurfaces() {
    const counts = new Map();
    const choiceSelector = [
      '[role="radio"]', 'input[type="radio"]',
      '[aria-pressed="true"]', '[aria-pressed="false"]',
      '[aria-selected="true"]', '[aria-selected="false"]',
      'button', '[role="button"]'
    ].join(',');
    for (const control of document.querySelectorAll(choiceSelector)) {
      if (!isRendered(control) || control.closest(
        'nav,[id^="chat-messages-"],[data-list-item-id^="chat-messages___"],' +
        '[contenteditable="true"],textarea,input[type="text"],[type="search"]'
      )) continue;
      const surface = closestSupplementalSurface(control);
      if (!surface || !surface.querySelector(
        'h1,h2,h3,[data-text-variant^="heading-"]'
      )) continue;
      const controlRect = control.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const semanticChoice = control.matches(
        '[role="radio"],input[type="radio"],' +
        '[aria-pressed="true"],[aria-pressed="false"],' +
        '[aria-selected="true"],[aria-selected="false"]'
      );
      const largeChoice = control.matches('button,[role="button"]') &&
        controlRect.width >= Math.min(220, surfaceRect.width * 0.28) &&
        controlRect.height >= 44;
      if (!semanticChoice && !largeChoice) continue;
      const count = counts.get(surface) || {semanticChoices: 0, largeChoices: 0};
      if (semanticChoice) count.semanticChoices++;
      if (largeChoice) count.largeChoices++;
      counts.set(surface, count);
    }
    return [...counts].filter(([, {semanticChoices, largeChoices}]) =>
      semanticChoices >= 2 || largeChoices >= 3
    ).map(([surface]) => surface);
  }
  function inviteApplicationRoots() {
    const roots = new Set();
    const controls = [...document.querySelectorAll(
      'textarea,input:not([type]),input[type="text"]'
    )].filter(control =>
      isRendered(control) &&
      !control.matches('[type="search"],[role="combobox"]') &&
      !control.closest('nav,[class*="searchBar_"],[class*="search_"]')
    );
    const surfaces = new Set();
    for (const control of controls) {
      const surface = closestSupplementalSurface(control);
      if (!surface) continue;
      const answers = [...surface.querySelectorAll(
        'textarea,input:not([type]),input[type="text"]'
      )].filter(isRendered);
      const hasAgreement = Boolean(surface.querySelector(
        'input[type="checkbox"],[role="checkbox"],[aria-checked]'
      ));
      if (answers.length >= 2 || (answers.length >= 1 && hasAgreement)) surfaces.add(surface);
    }
    for (const surface of surfaces) {
      addTextParents(surface, roots);
    }
    for (const surface of choiceQuestionnaireSurfaces()) {
      addTextParents(surface, roots, true);
    }
    return [...roots];
  }
  function messageContextId(root) {
    const row = root.closest(
      '[id^="chat-messages-"],[data-list-item-id^="chat-messages___"]'
    );
    return row
      ? ensureRootId(row, 'data-dto-message-context-id', 'message-context')
      : ensureRootId(root, 'data-dto-message-context-id', 'message-context');
  }
  const applicationRoots = inviteApplicationRoots();
  for (const root of applicationRoots) {
    const id = ensureRootId(root, 'data-dto-invite-context-id', 'invite-context');
    out.push(...parts('invite-context', id, root));
  }
  function scheduledEventRoots() {
    const roots = new Set();
    const eventSeeds = document.querySelectorAll([
      '[class*="guildEvent_"]', '[class*="eventCard_"]', '[class*="eventInfo_"]',
      '[class*="eventDetails_"]', '[class*="eventContent_"]', '[class*="eventName_"]',
      '[class*="eventTitle_"]', '[class*="eventDescription_"]', '[class*="eventLocation_"]',
      'time:not([id^="message-timestamp-"])'
    ].join(','));
    const surfaces = new Set();
    for (const seed of eventSeeds) {
      if (!isRendered(seed) || seed.closest('[id^="chat-messages-"]')) continue;
      const surface = closestSupplementalSurface(seed);
      if (surface) surfaces.add(surface);
    }
    for (const surface of surfaces) {
      addTextParents(surface, roots);
    }
    return [...roots];
  }
  for (const root of scheduledEventRoots()) {
    const id = ensureRootId(root, 'data-dto-event-context-id', 'event-context');
    out.push(...parts('event-context', id, root));
  }
  function channelBrowserRoots() {
    const roots = new Set();
    const surfaceCounts = new Map();
    for (const control of document.querySelectorAll(
      '[role="checkbox"],[role="switch"],input[type="checkbox"],[aria-checked]'
    )) {
      if (!isRendered(control) || control.closest('nav,[id^="chat-messages-"]')) continue;
      const surface = closestSupplementalSurface(control);
      if (!surface) continue;
      surfaceCounts.set(surface, (surfaceCounts.get(surface) || 0) + 1);
    }
    for (const [surface, count] of surfaceCounts) {
      if (count < 2) continue;
      addTextParents(surface, roots, true);
    }
    return [...roots];
  }
  for (const root of channelBrowserRoots()) {
    const id = ensureRootId(root, 'data-dto-browse-channel-id', 'browse-channel');
    out.push(...parts('browse-channel', id, root));
  }
  const contextSelector = [
    '[class*="guildDropdown_"] h2',
    '[class*="topic_"][class*="expandable_"]',
    'div[id^="chat-messages-"][class*="container_"] > div[class*="description_"]',
    '[role="dialog"] [class*="headerSubtitle_"]'
  ].join(',');
  for (const root of document.querySelectorAll(contextSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-context-id', 'context');
    out.push(...parts('context', id, root));
  }
  return {url: location.href, title: document.title, parts: out};
})()
"#;

pub const RESTORE_TEXT_SCRIPT: &str = r#"
(() => {
  const originals = window.__nudeTranslatorOriginals;
  let restored = 0;
  if (originals instanceof Map) {
    for (const [node, text] of originals) {
      if (!node?.isConnected) continue;
      if (node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
      else node.textContent = text;
      restored++;
    }
    originals.clear();
  }
  const locators = window.__nudeTranslatorOriginalsByLocator;
  if (!(locators instanceof Map)) return {restored, remaining: 0};
  function eligibleTextNodes(root, allowLinkText = false) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedSelector = allowLinkText
        ? 'code,pre,[contenteditable="true"],textarea,input'
        : 'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input';
      const protectedParent = parent.closest(
        protectedSelector
      );
      if (protectedParent && protectedParent !== root && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }
    return nodes;
  }
  function target(change) {
    let root = null;
    if (change.kind === 'message') root = document.querySelector(`[data-dto-message-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'reply') root = document.querySelector(`[data-dto-reply-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'embed') root = document.querySelector(`[data-dto-root-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'forum-title') root = document.querySelector(`[data-dto-forum-title-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'forum-tag') root = document.querySelector(`[data-dto-forum-tag-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'heading') root = document.querySelector(`[data-dto-heading-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'invite-context') root = document.querySelector(`[data-dto-invite-context-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'event-context') root = document.querySelector(`[data-dto-event-context-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'browse-channel') root = document.querySelector(`[data-dto-browse-channel-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'context') root = document.querySelector(`[data-dto-context-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'nickname') root = document.querySelector(`[data-dto-nickname-id="${CSS.escape(change.id)}"]`);
    else if (change.kind === 'channel') {
      const channel = document.querySelector(`[data-list-item-id="${CSS.escape(change.id)}"]`);
      return channel?.querySelector('div[aria-hidden="true"] > span,[class*="name__"][aria-hidden="true"] > div') || null;
    } else if (change.kind === 'category') {
      const category = document.querySelector(`[data-list-item-id="${CSS.escape(change.id)}"][role="button"]`);
      return category?.querySelector('h3 > div') || null;
    }
    return root ? eligibleTextNodes(root, change.kind === 'embed')[change.index] || null : null;
  }
  for (const [key, change] of [...locators]) {
    const node = target(change);
    if (!node) continue;
    if (node.nodeType === Node.TEXT_NODE) node.nodeValue = change.text;
    else node.textContent = change.text;
    locators.delete(key);
    restored++;
  }
  return {restored, remaining: locators.size};
})()
"#;

pub const INSTALL_TEXT_RESTORE_SCRIPT: &str = r#"
(() => {
  window.__nudeTranslatorRestoreTranslatedText = () => {
    const originals = window.__nudeTranslatorOriginals;
    let restored = 0;
    if (originals instanceof Map) {
      for (const [node, text] of originals) {
        if (!node?.isConnected) continue;
        if (node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
        else node.textContent = text;
        restored++;
      }
      originals.clear();
    }
    const locators = window.__nudeTranslatorOriginalsByLocator;
    if (!(locators instanceof Map)) return {restored, remaining: 0};
    function eligibleTextNodes(root, allowLinkText = false) {
      const nodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        const protectedSelector = allowLinkText
          ? 'code,pre,[contenteditable="true"],textarea,input'
          : 'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input';
        const protectedParent = parent.closest(
          protectedSelector
        );
        if (protectedParent && protectedParent !== root && root.contains(protectedParent)) continue;
        const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
        if (hiddenParent && hiddenParent !== root) continue;
        nodes.push(node);
      }
      return nodes;
    }
    function target(change) {
      let root = null;
      if (change.kind === 'message') root = document.querySelector(`[data-dto-message-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'reply') root = document.querySelector(`[data-dto-reply-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'embed') root = document.querySelector(`[data-dto-root-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'forum-title') root = document.querySelector(`[data-dto-forum-title-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'forum-tag') root = document.querySelector(`[data-dto-forum-tag-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'heading') root = document.querySelector(`[data-dto-heading-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'invite-context') root = document.querySelector(`[data-dto-invite-context-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'event-context') root = document.querySelector(`[data-dto-event-context-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'browse-channel') root = document.querySelector(`[data-dto-browse-channel-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'context') root = document.querySelector(`[data-dto-context-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'nickname') root = document.querySelector(`[data-dto-nickname-id="${CSS.escape(change.id)}"]`);
      else if (change.kind === 'channel') {
        const channel = document.querySelector(`[data-list-item-id="${CSS.escape(change.id)}"]`);
        return channel?.querySelector('div[aria-hidden="true"] > span,[class*="name__"][aria-hidden="true"] > div') || null;
      } else if (change.kind === 'category') {
        const category = document.querySelector(`[data-list-item-id="${CSS.escape(change.id)}"][role="button"]`);
        return category?.querySelector('h3 > div') || null;
      }
      return root ? eligibleTextNodes(root, change.kind === 'embed')[change.index] || null : null;
    }
    for (const [key, change] of [...locators]) {
      const node = target(change);
      if (!node) continue;
      if (node.nodeType === Node.TEXT_NODE) node.nodeValue = change.text;
      else node.textContent = change.text;
      locators.delete(key);
      restored++;
    }
    return {restored, remaining: locators.size};
  };
  return true;
})()
"#;

pub const CLEAR_TEXT_REGISTRY_SCRIPT: &str = r#"
(() => {
  const originals = window.__nudeTranslatorOriginals;
  if (originals instanceof Map) originals.clear();
  const locators = window.__nudeTranslatorOriginalsByLocator;
  if (locators instanceof Map) locators.clear();
})()
"#;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct DomPart {
    pub kind: String,
    #[serde(rename = "id")]
    pub item_id: String,
    #[serde(default, rename = "contextId")]
    pub context_id: Option<String>,
    pub index: usize,
    pub text: String,
    #[serde(default, rename = "displayedText")]
    pub displayed_text: Option<String>,
}

impl DomPart {
    pub fn locator(&self) -> (String, String, usize) {
        (self.kind.clone(), self.item_id.clone(), self.index)
    }

    pub fn rendered_text(&self) -> &str {
        self.displayed_text.as_deref().unwrap_or(&self.text)
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
        .map_err(|error| format!("Discord DOM 스냅샷을 읽지 못했습니다: {error}"))
}

pub fn apply_script(changes: &[DomChange]) -> Result<String, String> {
    let encoded = serde_json::to_string(changes)
        .map_err(|error| format!("DOM 번역 변경 목록을 만들지 못했습니다: {error}"))?;
    Ok(format!(
        r#"
(() => {{
  const changes = {encoded};
  const originals = window.__nudeTranslatorOriginals instanceof Map
    ? window.__nudeTranslatorOriginals
    : new Map();
  window.__nudeTranslatorOriginals = originals;
  const originalLocators = window.__nudeTranslatorOriginalsByLocator instanceof Map
    ? window.__nudeTranslatorOriginalsByLocator
    : new Map();
  window.__nudeTranslatorOriginalsByLocator = originalLocators;
  function remember(node, text, change) {{
    if (node && !originals.has(node)) originals.set(node, text);
    const key = JSON.stringify([change.kind, change.id, change.index]);
    if (!originalLocators.has(key)) originalLocators.set(key, {{...change, text}});
  }}
  function eligibleTextNodes(root, allowLinkText = false) {{
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {{
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedSelector = allowLinkText
        ? 'code,pre,[contenteditable="true"],textarea,input'
        : 'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input';
      const protectedParent = parent.closest(
        protectedSelector
      );
      if (protectedParent && protectedParent !== root && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }}
    return nodes;
  }}
  function isOutgoingMessage(root) {{
    if (root?.getAttribute('data-nt-outgoing-original') === 'true') return true;
    const manager = window.__nudeTranslatorOutgoingOriginalDisplay;
    if (!(manager?.records instanceof Map)) return false;
    const prefix = 'message-content-';
    if (!root?.id?.startsWith(prefix)) return false;
    const messageId = root.id.slice(prefix.length);
    const channel = location.pathname.startsWith('/channels/') ? location.pathname : '';
    return Boolean(channel && messageId && manager.records.has(`${{channel}}|${{messageId}}`));
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
    else if (change.kind === 'forum-tag') root = document.querySelector(
      `[data-dto-forum-tag-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'heading') root = document.querySelector(
      `[data-dto-heading-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'invite-context') root = document.querySelector(
      `[data-dto-invite-context-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'event-context') root = document.querySelector(
      `[data-dto-event-context-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'browse-channel') root = document.querySelector(
      `[data-dto-browse-channel-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'context') root = document.querySelector(
      `[data-dto-context-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'nickname') root = document.querySelector(
      `[data-dto-nickname-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'channel') {{
      const channel = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"]`
      );
      root = channel?.querySelector(
        'div[aria-hidden="true"] > span,' +
        '[class*="name__"][aria-hidden="true"] > div'
      ) || null;
      if (root) {{
        remember(root, root.textContent, change);
        root.textContent = change.text;
        applied++;
        continue;
      }}
    }}
    else if (change.kind === 'category') {{
      const category = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"][role="button"]`
      );
      root = category?.querySelector('h3 > div') || null;
      if (root) {{
        remember(root, root.textContent, change);
        root.textContent = change.text;
        applied++;
        continue;
      }}
    }}
    if (!root || (change.kind === 'message' && isOutgoingMessage(root))) continue;
    const nodes = eligibleTextNodes(root, change.kind === 'embed');
    const node = nodes[change.index];
    if (!node) continue;
    remember(node, node.nodeValue, change);
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
    use super::{
        apply_script, parse_snapshot, DomChange, DomPart, CLEAR_TEXT_REGISTRY_SCRIPT,
        INSTALL_TEXT_RESTORE_SCRIPT, RESTORE_TEXT_SCRIPT, SNAPSHOT_SCRIPT,
    };
    use crate::cdp::{discord_target, CdpClient};
    use serde_json::json;

    #[test]
    fn snapshot_payload_preserves_locator_and_text() {
        let snapshot = parse_snapshot(json!({
            "url": "https://discord.com/channels/1/2",
            "title": "Discord",
            "parts": [{
                "kind": "message",
                "id": "dto-message-1",
                "contextId": "dto-message-context-1",
                "index": 2,
                "text": "hello",
                "displayedText": "안녕"
            }]
        }))
        .unwrap();
        assert_eq!(
            snapshot.parts[0].locator(),
            ("message".into(), "dto-message-1".into(), 2)
        );
        assert_eq!(snapshot.parts[0].text, "hello");
        assert_eq!(
            snapshot.parts[0].context_id.as_deref(),
            Some("dto-message-context-1")
        );
        assert_eq!(snapshot.parts[0].rendered_text(), "안녕");
        assert!(SNAPSHOT_SCRIPT.contains("message-reply-context-"));
        assert!(SNAPSHOT_SCRIPT.contains("data-nt-outgoing-original"));
        assert!(SNAPSHOT_SCRIPT.contains("postTitleText"));
    }

    #[test]
    fn snapshot_supports_read_only_rules_channel_message_containers() {
        assert!(SNAPSHOT_SCRIPT.contains("messageRootCandidates"));
        assert!(SNAPSHOT_SCRIPT.contains("messageContextId"));
        assert!(SNAPSHOT_SCRIPT.contains("data-dto-message-context-id"));
        assert!(SNAPSHOT_SCRIPT.contains("[id^=\"chat-messages-\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[data-list-item-id^=\"chat-messages___\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"messageContent_\"]"));
    }

    #[test]
    fn snapshot_and_apply_scripts_support_message_nicknames() {
        assert!(SNAPSHOT_SCRIPT.contains("[id^=\"message-username-\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"username_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("parts('nickname'"));

        let script = apply_script(&[DomChange {
            kind: "nickname".to_string(),
            id: "dto-nickname-1".to_string(),
            index: 0,
            text: "Neko".to_string(),
        }])
        .expect("nickname change script");
        assert!(script.contains("data-dto-nickname-id"));
        assert!(RESTORE_TEXT_SCRIPT.contains("data-dto-nickname-id"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("data-dto-nickname-id"));
    }

    #[test]
    fn snapshot_supports_invite_application_rules_and_questions() {
        assert!(SNAPSHOT_SCRIPT.contains("inviteApplicationRoots"));
        assert!(SNAPSHOT_SCRIPT.contains("closestSupplementalSurface"));
        assert!(SNAPSHOT_SCRIPT.contains("addTextParents"));
        assert!(SNAPSHOT_SCRIPT.contains("parts('invite-context'"));
        assert!(SNAPSHOT_SCRIPT.contains("data-dto-invite-context-id"));
        assert!(RESTORE_TEXT_SCRIPT.contains("data-dto-invite-context-id"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("data-dto-invite-context-id"));

        let part = DomPart {
            kind: "invite-context".to_string(),
            item_id: "dto-invite-context-1".to_string(),
            context_id: None,
            index: 0,
            text: "Wer bist du?".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "누구인가요?")]).unwrap();
        assert!(script.contains("data-dto-invite-context-id"));
    }

    #[test]
    fn snapshot_supports_choice_only_onboarding_questions() {
        assert!(SNAPSHOT_SCRIPT.contains("choiceQuestionnaireSurfaces"));
        assert!(SNAPSHOT_SCRIPT.contains("[role=\"radio\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("input[type=\"radio\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("closestSupplementalSurface(control)"));
        assert!(!SNAPSHOT_SCRIPT.contains("const dialog = control.closest('[role=\"dialog\"]');"));
        assert!(SNAPSHOT_SCRIPT.contains("semanticChoices >= 2 || largeChoices >= 3"));
        assert!(SNAPSHOT_SCRIPT.contains("addTextParents(surface, roots, true)"));
    }

    #[test]
    fn snapshot_supports_scheduled_event_content() {
        assert!(SNAPSHOT_SCRIPT.contains("scheduledEventRoots"));
        assert!(SNAPSHOT_SCRIPT.contains("eventSeeds"));
        assert!(SNAPSHOT_SCRIPT.contains("closestSupplementalSurface"));
        assert!(SNAPSHOT_SCRIPT.contains("parts('event-context'"));
        assert!(SNAPSHOT_SCRIPT.contains("data-dto-event-context-id"));
        assert!(RESTORE_TEXT_SCRIPT.contains("data-dto-event-context-id"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("data-dto-event-context-id"));

        let part = DomPart {
            kind: "event-context".to_string(),
            item_id: "dto-event-context-1".to_string(),
            context_id: None,
            index: 0,
            text: "ちょっと借ります".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "잠깐 빌릴게요")]).unwrap();
        assert!(script.contains("data-dto-event-context-id"));
    }

    #[test]
    fn snapshot_supports_channel_browser_names_and_descriptions() {
        assert!(SNAPSHOT_SCRIPT.contains("channelBrowserRoots"));
        assert!(SNAPSHOT_SCRIPT.contains("[aria-checked]"));
        assert!(SNAPSHOT_SCRIPT.contains("closestSupplementalSurface"));
        assert!(!SNAPSHOT_SCRIPT.contains("location.pathname.includes('/customize-community')"));
        assert!(SNAPSHOT_SCRIPT.contains("parts('browse-channel'"));
        assert!(SNAPSHOT_SCRIPT.contains("data-dto-browse-channel-id"));
        assert!(RESTORE_TEXT_SCRIPT.contains("data-dto-browse-channel-id"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("data-dto-browse-channel-id"));

        let part = DomPart {
            kind: "browse-channel".to_string(),
            item_id: "dto-browse-channel-1".to_string(),
            context_id: None,
            index: 0,
            text: "Hey, check out the channel".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "이 채널을 확인해 보세요")]).unwrap();
        assert!(script.contains("data-dto-browse-channel-id"));
    }

    #[test]
    fn category_snapshot_does_not_depend_on_discord_ui_language() {
        assert!(SNAPSHOT_SCRIPT.contains("[data-list-item-id^=\"channels___\"][role=\"button\"]"));
        assert!(!SNAPSHOT_SCRIPT.contains("aria-label$=\"(카테고리)\""));
    }

    #[test]
    fn snapshot_supports_current_forum_cards_and_tags() {
        assert!(SNAPSHOT_SCRIPT
            .contains("li[class*=\"container_\"][class*=\"card_\"] h3[class*=\"title__\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[data-list-item-id*=\"-tags-navigator___forum-tag-\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"tagPill__\"]"));
        assert!(RESTORE_TEXT_SCRIPT.contains("data-dto-forum-tag-id"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("data-dto-forum-tag-id"));

        let part = DomPart {
            kind: "forum-tag".to_string(),
            item_id: "dto-forum-tag-1".to_string(),
            context_id: None,
            index: 0,
            text: "動画編集".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "동영상 편집")]).unwrap();
        assert!(script.contains("data-dto-forum-tag-id"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러와 포럼 채널 화면이 필요해"]
    fn live_forum_titles_and_tags_are_snapshotted() {
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();

        let snapshot = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        let title = snapshot
            .parts
            .iter()
            .find(|part| {
                part.kind == "forum-title" && part.text == "自己紹介用フォーラムの投稿方法について"
            })
            .cloned()
            .expect("포럼 게시글 제목이 스냅샷에 포함되어야 해");
        let tag = snapshot
            .parts
            .iter()
            .find(|part| part.kind == "forum-tag" && part.text == "動画編集")
            .cloned()
            .expect("포럼 태그가 스냅샷에 포함되어야 해");
        assert!(snapshot
            .parts
            .iter()
            .any(|part| part.kind == "forum-tag" && part.text == "録画"));

        let script = apply_script(&[
            DomChange::new(&title, "포럼 제목 번역 검증"),
            DomChange::new(&tag, "포럼 태그 번역 검증"),
        ])
        .unwrap();
        let applied = client.evaluate(&script, false).unwrap();
        assert_eq!(applied["applied"], 2);
        client.evaluate(RESTORE_TEXT_SCRIPT, false).unwrap();
        client.close();
    }

    #[test]
    fn embed_link_root_text_remains_eligible_for_translation() {
        assert_eq!(
            SNAPSHOT_SCRIPT.matches("protectedParent !== root").count(),
            1
        );
        assert_eq!(
            RESTORE_TEXT_SCRIPT
                .matches("protectedParent !== root")
                .count(),
            1
        );

        let part = DomPart {
            kind: "embed".to_string(),
            item_id: "dto-embed-link-title".to_string(),
            context_id: None,
            index: 0,
            text: "원문 제목".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "번역된 제목")]).unwrap();
        assert_eq!(script.matches("protectedParent !== root").count(), 1);
    }

    #[test]
    fn snapshot_captures_complete_link_preview_cards_and_nested_link_text() {
        assert!(SNAPSHOT_SCRIPT.contains("embedContainerSelector"));
        assert!(SNAPSHOT_SCRIPT.contains("article[class*=\"embed_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"embedFull_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"embedAuthorName_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"embedDescription_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("embedRoots.add(outerEmbedRoot(root))"));
        assert!(SNAPSHOT_SCRIPT.contains("parts('embed', id, root, true)"));
        assert!(RESTORE_TEXT_SCRIPT.contains("eligibleTextNodes(root, change.kind === 'embed')"));
        assert!(INSTALL_TEXT_RESTORE_SCRIPT
            .contains("eligibleTextNodes(root, change.kind === 'embed')"));
        assert!(SNAPSHOT_SCRIPT.contains(
            "allowLinkText\n        ? 'code,pre,[contenteditable=\"true\"],textarea,input'"
        ));
        assert!(
            !SNAPSHOT_SCRIPT.contains("allowLinkText\n        ? 'button,[role=\"button\"],code")
        );

        let part = DomPart {
            kind: "embed".to_string(),
            item_id: "dto-embed-card".to_string(),
            context_id: None,
            index: 0,
            text: "#かぷちゃあばたーず".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "#카푸치아바타즈")]).unwrap();
        assert!(script.contains("eligibleTextNodes(root, change.kind === 'embed')"));
    }

    #[test]
    fn snapshot_collects_invite_preview_descriptions_without_native_controls() {
        assert!(SNAPSHOT_SCRIPT.contains("invitePreviewDescriptionRoots"));
        assert!(SNAPSHOT_SCRIPT.contains("a[href*=\"discord.gg/\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("a[href*=\"discord.com/invite/\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"guildDescription_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("[class*=\"description_\"]"));
        assert!(SNAPSHOT_SCRIPT.contains("closest('a,button,[role=\"button\"]')"));
        assert!(SNAPSHOT_SCRIPT.contains("embedRoots.add(root)"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러와 화면에 보이는 링크 미리보기가 필요해"]
    fn live_embed_title_translates_without_breaking_its_link() {
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        client.connect().unwrap();

        let scrolled = client
            .evaluate(
                r#"(() => { const root=[...document.querySelectorAll('a[class*="embedTitle_"]')].find(node => node.textContent?.trim()); if (!root) return false; root.scrollIntoView({block:'center'}); return true; })()"#,
                false,
            )
            .unwrap();
        assert_eq!(scrolled, true);
        let before = parse_snapshot(client.evaluate(SNAPSHOT_SCRIPT, false).unwrap()).unwrap();
        let title_id = client
            .evaluate(
                r#"(() => [...document.querySelectorAll('a[class*="embedTitle_"][data-dto-root-id]')].find(node => { const rect=node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; })?.getAttribute('data-dto-root-id') || null)()"#,
                false,
            )
            .unwrap();
        let title_id = title_id
            .as_str()
            .expect("화면에 번역 검증용 링크 미리보기 제목이 필요해");
        let title = before
            .parts
            .iter()
            .find(|part| part.kind == "embed" && part.item_id == title_id)
            .cloned()
            .expect("화면에 번역 검증용 링크 미리보기 제목이 필요해");
        let id = serde_json::to_string(&title.item_id).unwrap();
        let href_before = client
            .evaluate(
                &format!(
                    "(() => document.querySelector(`[data-dto-root-id=\"${{CSS.escape({id})}}\"]`)?.href || null)()"
                ),
                false,
            )
            .unwrap();
        assert!(href_before.as_str().is_some_and(|href| !href.is_empty()));

        let marker = "링크 미리보기 제목 번역 검증";
        let script = apply_script(&[DomChange::new(&title, marker)]).unwrap();
        client.evaluate(&script, false).unwrap();
        let translated = client
            .evaluate(
                &format!(
                    "(() => {{ const root=document.querySelector(`[data-dto-root-id=\"${{CSS.escape({id})}}\"]`); return {{text: root?.textContent || null, href: root?.href || null}}; }})()"
                ),
                false,
            )
            .unwrap();
        client.evaluate(RESTORE_TEXT_SCRIPT, false).unwrap();
        client.close();

        assert_eq!(translated["text"], marker);
        assert_eq!(translated["href"], href_before);
    }

    #[test]
    fn snapshot_keeps_canonical_original_separate_from_rendered_translation() {
        assert!(SNAPSHOT_SCRIPT.contains("canonicalOriginal"));
        assert!(SNAPSHOT_SCRIPT.contains("displayedText"));
        assert!(SNAPSHOT_SCRIPT.contains("__nudeTranslatorOriginalsByLocator"));
    }

    #[test]
    fn outgoing_messages_are_excluded_during_discord_scroll_remounts() {
        assert!(SNAPSHOT_SCRIPT.contains("__nudeTranslatorOutgoingOriginalDisplay"));
        assert!(SNAPSHOT_SCRIPT.contains("manager.records.has"));

        let part = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-scroll-remount".to_string(),
            context_id: None,
            index: 0,
            text: "送信した文".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "번역된 문장")]).unwrap();
        assert!(script.contains("data-nt-outgoing-original"));
    }

    #[test]
    fn changes_are_json_encoded_without_script_injection() {
        let part = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-1".to_string(),
            context_id: None,
            index: 0,
            text: "original".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "` ${alert(1)} \"번역\"")]).unwrap();
        assert!(script.contains(r#""text":"` ${alert(1)} \"번역\"""#));
        assert!(script.contains("CSS.escape(change.id)"));
    }

    #[test]
    fn translated_nodes_register_their_original_text_for_shutdown_restore() {
        let part = DomPart {
            kind: "message".to_string(),
            item_id: "dto-message-1".to_string(),
            context_id: None,
            index: 0,
            text: "원문".to_string(),
            displayed_text: None,
        };
        let script = apply_script(&[DomChange::new(&part, "번역문")]).unwrap();
        assert!(script.contains("__nudeTranslatorOriginals"));
        assert!(script.contains("originals.set"));
        assert!(script.contains("__nudeTranslatorOriginalsByLocator"));
        assert!(script.contains("originalLocators.set"));
        assert!(RESTORE_TEXT_SCRIPT.contains("originals.clear"));
        assert!(RESTORE_TEXT_SCRIPT.contains("locators.delete"));
        assert!(CLEAR_TEXT_REGISTRY_SCRIPT.contains("originals.clear"));
        assert!(CLEAR_TEXT_REGISTRY_SCRIPT.contains("locators.clear"));
        assert!(
            INSTALL_TEXT_RESTORE_SCRIPT.contains("window.__nudeTranslatorRestoreTranslatedText")
        );
        assert!(INSTALL_TEXT_RESTORE_SCRIPT.contains("locators.delete"));
    }
}
