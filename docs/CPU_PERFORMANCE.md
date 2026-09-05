# CPU translation performance validation

## Scope and observations (2026-09-05)

The user reported game slowdown with local CPU translation. On their 32-logical-CPU Windows PC, with Crimson Desert running, an approximately 34-second observation of active Discord display translation measured the model at 33.3% average total CPU and 50.0% in the busiest five-second interval. Display requests were queued for as long as 28.6 seconds. A later quieter 25-second interval measured 1.82% model CPU with occasional display requests. These are different workloads, not an optimization A/B comparison. An earlier run of the old application exited with Windows exception `0xc0000409`; its cause was not established and this change does not claim to repair that crash.

## Implementation

- CPU generation and prompt-processing pools each use `clamp(logical_cpus / 2, 1, 6)` workers.
- CPU `--poll 0 --poll-batch 0` disables worker busy polling, and `--prio -1` requests lower inference priority.
- GPU execution remains unchanged. The CPU policy also covers CPU fallback. No artificial translation delay, automatic background pause, model/prompt change, cache clearing, or queue-policy change is introduced.
- Guardian process checks retain all existing executable/main-process/pipe validation, but refresh the known PID first. Full discovery occurs only after that match fails, preserving PID handoff and the 15-second grace period. Existing guardian executable copies remain active until the next normal Discord restart.

## Controlled comparison

`scripts/benchmark-cpu-translation.ps1` launches one isolated local CPU server at a time on a temporary loopback port. The desktop translator was stopped during comparisons, and restarted afterward. The game remained running. Requests use synthetic English text, Korean output, seed 42, temperature zero, no prompt cache, and one excluded warmup request. This tests the real packaged model/runtime; it bypasses the application's translation cache, protected-text processing, and UI. Source and translated fixture text in the report are synthetic, not private conversations.

An exploratory comparison of default, eight, six and four workers selected six workers as a conservative balance. The clean confirmation run reversed the default/six order, with three rounds of three short/paragraph samples each. No build or test suite ran concurrently with that confirmation or the long-text comparison.

| Workload | Default mean latency | Six-worker mean latency | Default model CPU | Six-worker model CPU |
| --- | ---: | ---: | ---: | ---: |
| Short/paragraph confirmation, 9 requests per profile | 1.212 s | 1.205 s | 47.26% | 18.40% |
| Long text, 3 requests per profile | 5.496 s | 5.349 s | 47.00% | 18.38% |

CPU usage is measured from server process CPU time divided by request wall time and 32 logical CPUs. These runs reduced model CPU by approximately 61%, with no observed mean latency regression. All corresponding outputs were identical and stopped normally, including the longer text. The multi-paragraph fixture's raw model formatting was identical across profiles; preservation of the application's source layout is separately covered by outgoing-review tests. This small corpus is not a comprehensive translation-quality evaluation. Results on other CPUs, Hy-MT2 7B, or TranslateGemma 4B have not been established.

The read-only `benchmark_guardian_process_queries` test performed 50 full queries and 50 targeted queries against the actual Discord process. Mean query wall time decreased from 29.863 ms (575 retained processes) to 13.067 ms (one process), approximately 56%. Both paths rejected a mismatched installation path. This is query cost, not a measured 56% reduction of total application CPU.

## Reproduction

Run the benchmark with the desktop model stopped to avoid overlapping model workloads. Supply explicit packaged server and installed model paths:

```powershell
./scripts/benchmark-cpu-translation.ps1 -ServerPath <llama-server.exe> -ModelPath <model.gguf> -Profiles @('6','default') -Rounds 3
./scripts/benchmark-cpu-translation.ps1 -ServerPath <llama-server.exe> -ModelPath <model.gguf> -Profiles @('default','6') -Rounds 3 -LongText -OutputPath artifacts/cpu-translation-long.json
cargo test --manifest-path src-tauri/Cargo.toml benchmark_guardian_process_queries -- --ignored --nocapture
```

`-ExistingServerProcessId` optionally exercises the running installed model instead of launching or terminating a server. That mode verifies the executable and loopback address but shares resources with ordinary translation requests; its latency and CPU numbers are not an isolated A/B comparison.

## Limits and regression checks

The CPU configuration and guardian lookup tests failed before implementation and passed afterward. Functional regression coverage includes outgoing line/blank-line/tab preservation, cancellation while editing, channel switching, stale display results, and protected content. Game FPS and frame-time percentiles were not captured, so CPU improvements must not be described as a measured FPS improvement. The observed old-version crash and automatic display translation of periodically changing text remain separate follow-up investigations.

## Installed application and final verification

The release executable was rebuilt and the existing desktop shortcut's target, working directory, and icon were synchronized. The running application path and product version (`0.7.5-beta`) matched the new executable. Its child model command line contained both six-worker limits, both zero-poll flags, CPU-only execution, and priority `-1`. Discord and Crimson Desert were not restarted, and no Discord message was sent.

Nine synthetic requests against this application's actual model server averaged 1.216 seconds and 18.34% model CPU. All nine outputs matched the isolated six-worker results and stopped normally. A concurrent 30.58-second observation, including both these requests and idle time, measured model CPU at 7.12% average / 18.07% busiest five-second interval and application CPU at 0.76% average. These are live observations, not another matched before/after comparison. The retained old guardian still averaged 0.33% CPU; its optimization awaits the next normal Discord restart. The application and model remained running, with no matching Windows Application Error event observed after this launch; this short check does not establish long-term crash stability.

Executed checks:

- `npm test`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 467 passed, 48 ignored, zero failures.
- `npm run test:e2e`: 172 passed. These browser fixtures and simulated translation providers test functional regressions, not real-game frame times or every production translation provider.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `git diff --check`: passed.
- `cargo build --release --manifest-path src-tauri/Cargo.toml`: passed; the existing `LNK4098` library-conflict warning remains.
- The separate, normally ignored Windows guardian query benchmark passed against live Discord. Isolated short/long and installed-server benchmarks passed against the packaged local model.

No common web DOM collection/application code changed, so the public website sample suite was not rerun for this optimization. GPU performance, other model sizes, other CPUs, long sessions, and subjective in-game responsiveness remain outside this measurement.
