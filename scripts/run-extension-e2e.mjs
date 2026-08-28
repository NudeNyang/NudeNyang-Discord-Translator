import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const arguments_ = process.argv.slice(2);
const mode = arguments_[0] === "--install" ? arguments_.shift() : "--test";
const cliArguments = mode === "--install"
  ? ["install", "chromium", "--no-shell", ...arguments_]
  : ["test", "--config", "extension/e2e/playwright.config.mjs", ...arguments_];

// Use Playwright's documented hermetic installation for BOTH install and run.
// Keep the test browsers with their pinned npm dependency, outside the user's
// browser profile and shared LOCALAPPDATA cache. This also avoids Windows SxS
// manifest loading failures observed in that shared cache on the test host.
const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve("@playwright/test/cli")), ...cliArguments], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", error => {
  console.error(`Unable to start the extension E2E runner: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
