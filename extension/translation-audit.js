(function exposeTranslationAudit(root) {
  const SUSPECTS = new Set(["undiscovered", "not_queued", "request_failed", "missing_result", "quality_failed", "unchanged_result", "apply_lost", "source_changed"]);
  const increment = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };

  // A separate, bounded depth-first traversal. It never calls collectBlocks or
  // uses its selectors. Only safety boundaries and per-node decisions are shared.
  // Reports contain counts/ordinals/tags, never text, hashes, attributes or URLs.
  async function inspect(document, { boundary, explain, visible, stage,
    isCurrent = () => true, maxNodes = 5000, maxDurationMs = 1500, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    const report = { status: "complete", visited: 0, candidates: 0, counts: {}, excluded: {}, unsupported: {}, suspects: [], review: [] };
    const scope = document.body;
    let node = scope;
    const startedAt = performance.now();
    let sliceStart = startedAt;
    while (node) {
      if (!isCurrent()) { report.status = "cancelled"; break; }
      if (report.visited >= maxNodes) { report.status = "limited"; break; }
      if (performance.now() - startedAt >= maxDurationMs) { report.status = "limited"; break; }
      report.visited += 1;
      let prune = false;
      if (node.nodeType === 1) {
        const reason = boundary(node);
        if (reason) {
          increment(reason.startsWith("unsupported_") ? report.unsupported : report.excluded,
            reason.replace(/^unsupported_/, ""));
          prune = true;
        } else if (node.shadowRoot) increment(report.unsupported, "shadow_root");
      } else if (node.nodeType === 3) {
        const decision = explain(node);
        if (!decision.eligible) {
          increment(report.excluded, decision.reason);
          // Soft policy exclusions are NOT proof that a text should be excluded.
          // Keep a separate review list; do not read or automatically translate it.
          if (["excluded_scope", "outside_scope"].includes(decision.reason) && report.review.length < 40) {
            report.review.push({ ordinal: report.visited, tag: node.parentElement.localName, reason: decision.reason });
          }
        }
        else if (!visible(node.parentElement)) increment(report.counts, "offscreen");
        else if (/\p{L}/u.test(node.nodeValue ?? "")) {
          report.candidates += 1;
          const state = stage(node, decision.block);
          increment(report.counts, state);
          if (SUSPECTS.has(state) && report.suspects.length < 40) {
            report.suspects.push({ ordinal: report.visited, tag: node.parentElement.localName, reason: state });
          }
        }
      }
      if (!prune && node.firstChild) node = node.firstChild;
      else {
        while (node && node !== scope && !node.nextSibling) node = node.parentNode;
        node = !node || node === scope ? null : node.nextSibling;
      }
      if (report.visited % 100 === 0 || performance.now() - sliceStart >= 8) {
        await yieldTask();
        sliceStart = performance.now();
      }
    }
    if (!isCurrent()) report.status = "cancelled";
    return report;
  }
  root.NudeNyangTranslationAudit = Object.freeze({ inspect });
})(globalThis);
