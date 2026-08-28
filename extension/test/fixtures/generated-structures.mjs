// Test-owned oracle: expected text is specified BEFORE the product sees the DOM.
// Enumerated dimensions are reproducible and do not encode any website selector.
export function structureCase(index) {
  let cursor = index;
  const choose = values => { const value = values[cursor % values.length]; cursor = Math.floor(cursor / values.length); return value; };
  const tag = choose(["p", "div", "li", "blockquote"]);
  const wrappers = choose([0, 1, 3, 6]);
  const inline = choose(["span", "strong", "em", "a"]);
  const layout = choose(["block", "flex", "grid", "contents"]);
  const split = choose([false, true]);
  const container = choose(["div", "section", "article", "details"]);
  return renderStructure(index, { tag, wrappers, inline, layout, split, container });
}

function renderStructure(index, dimensions) {
  const { tag, wrappers, inline, layout, split, container } = dimensions;
  const copies = [`説明${index}です。`, `続き${index}です。`];
  const inlineOpen = `<${inline}${inline === "a" ? ' href="/public/read"' : ""}>`;
  const content = split ? `${copies[0]}<br>${inlineOpen}${copies[1]}</${inline}>` : `${inlineOpen}${copies.join("")}</${inline}>`;
  const text = `<${tag} id="subject" style="display:${layout}">${content}</${tag}>`;
  const wrapped = "<div>".repeat(wrappers) + (tag === "li" ? `<ul>${text}</ul>` : text) + "</div>".repeat(wrappers);
  return { index, html: `<main><${container}${container === "details" ? " open" : ""}>${wrapped}</${container}><input value="private-sentinel"><div contenteditable>private-sentinel</div><code>private-sentinel</code><a href="https://example.org/">https://example.org/</a></main>`,
    expected: split ? copies : [copies.join("")], original: copies.join(""), dimensions };
}

export const STRUCTURE_CASE_COUNT = 4 * 4 * 4 * 4 * 2 * 4;

// Minimize a failing test-owned case by removing neutral wrappers while keeping
// the original expected text. This does not use product eligibility as its oracle.
export async function minimizeStructure(entry, fails) {
  let result = entry;
  for (const [key, value] of Object.entries({ wrappers: 0, layout: "block", tag: "p", inline: "span", container: "div" })) {
    const candidate = renderStructure(entry.index, { ...result.dimensions, [key]: value });
    if (await fails(candidate)) result = candidate;
  }
  return result;
}
