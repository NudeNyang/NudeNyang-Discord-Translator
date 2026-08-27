(function exposeDownloadFeed(root) {
  const RELEASES_URL = "https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases";
  const FEED_URL = "https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json";
  function parseRelease(feed) {
    const version = feed?.version;
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(version)) {
      throw new Error("Invalid release version");
    }
    function installer(platform, architecture) {
      const entry = feed.platforms?.[platform];
      const expected = `${RELEASES_URL}/download/v${version}/NudeNyang-Translator-${version}-${architecture}-Setup.exe`;
      // Exact first-party asset URLs only: no scripts, redirects, foreign repos,
      // portable builds, mixed versions, or partial architecture publication.
      if (entry?.url !== expected || typeof entry.signature !== "string" || !entry.signature.trim()
        || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? "")) throw new Error("Incomplete release");
      return expected;
    }
    return Object.freeze({ version, page: `${RELEASES_URL}/tag/v${version}`,
      x64: installer("windows-x86_64", "x64"), arm64: installer("windows-aarch64", "ARM64") });
  }
  root.NudeNyangDownloadFeed = Object.freeze({ FEED_URL, RELEASES_URL, parseRelease });
})(globalThis);
