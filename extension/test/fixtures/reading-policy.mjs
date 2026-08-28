// Test-owned text expectations. No product collector or website selectors.
export const READING_UI_HTML = `<main>
  <nav><a id="account-link" href="/account">private-account-sentinel</a><a href="/read">Read articles</a></nav>
  <form><fieldset><legend id="legend">Search catalogue</legend>
    <label for="query" id="label">Search words</label>
    <input id="query" aria-describedby="help" value="private-input-sentinel">
    <p id="help">Enter a product name</p><p id="form-private">private-form-sentinel</p>
    <button id="search" type="button"><span>Search catalogue now</span></button>
  </fieldset></form>
  <div role="tablist"><button role="tab" aria-selected="true" id="tab">Product details</button></div>
  <section class="cookie-consent"><p id="cookie-help">Choose which cookies to allow</p>
    <button id="cookie-button">Reject optional cookies</button><input type="checkbox" checked>
  </section>
  <p class="price"><span itemprop="price" id="amount">1200 JPY</span><span id="price-copy">Tax included</span></p>
  <div contenteditable id="draft">private-draft-sentinel</div>
  <address id="address">private-address-sentinel</address>
  <span itemprop="email">private@example.invalid</span>
  <code>private-code-sentinel</code><span translate="no">private-translation-sentinel</span>
  <span hidden>private-hidden-sentinel</span>
</main>`;
export const READING_UI_EXPECTED = [
  "Read articles", "Search catalogue", "Search words", "Enter a product name",
  "Search catalogue now", "Product details", "Choose which cookies to allow", "Reject optional cookies", "Tax included",
];

export const ACCOUNT_UI_HTML = `<main>
  <h1 id="heading">Account settings</h1>
  <p id="unclassified">private-unclassified-sentinel</p>
  <form><label for="password" id="password-label">Password</label>
    <input id="password" type="password" aria-describedby="password-help" value="private-password-sentinel">
    <p id="password-help">Use at least twelve characters</p>
    <button type="button" id="save">Save changes</button>
  </form>
  <dl><dt id="account-label">Account identifier</dt><dd>private-account-sentinel</dd></dl>
  <section itemscope itemtype="https://schema.org/Product"><span itemprop="name" id="product">Blue cotton shirt</span></section>
  <span itemprop="orderStatus" id="order-status">Preparing shipment</span>
  <span itemprop="orderNumber">private-order-sentinel</span>
  <span itemprop="price">1200 JPY</span>
  <div itemscope itemtype="https://schema.org/Person"><h2>private-person-sentinel</h2></div>
  <address>private-address-sentinel</address>
</main>`;
export const ACCOUNT_UI_EXPECTED = ["Account settings", "Password", "Use at least twelve characters", "Save changes",
  "Account identifier", "Blue cotton shirt", "Preparing shipment"];
