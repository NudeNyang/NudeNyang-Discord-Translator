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

## Cooperative web/Discord scheduling (2026-09-05 follow-up)

After Discord restarted, the new guardian executable hash matched the optimized application, and its observed CPU was 0.19–0.24%. CPU inference remained around 18.5% during synthetic requests. However, live queue metadata showed Discord display requests waiting up to 10.687 seconds behind browser batches. In the worker, a whole browser request ran synchronously; equal-priority work also selected the newest request first. This was a responsiveness issue separate from the CPU worker budget.

Two new reproduction tests failed before the scheduler change: `scheduling_browser_requests_do_not_jump_ahead_of_older_work` selected the newer browser request, and `scheduling_browser_yields_to_discord_between_paragraphs` processed all four web paragraphs before the queued Discord message. Both pass with FIFO lanes and resumable browser block groups. Additional tests cover lane rotation, whole/non-contiguous block preservation, efficient short-label grouping, original result order, permission revocation after a partial result, full-request heading language evidence, and private cache isolation across yields.

The `scheduling_live_cpu_model_latency_comparison` ignored test uses the production worker and translation service with the actual packaged Hy-MT2 1.8B CPU runtime. Four synthetic English web paragraphs and one synthetic Discord message are identical across runs. The Discord request is deterministically queued when the first web inference starts. A wrapper uses the whole-batch provider path to emulate the former uninterrupted behavior, and the normal local path for the cooperative comparison; neither path contacts an external service. Request caches are disabled for timing, warmup is excluded, and output equality/item identities are checked. The desktop application was stopped to avoid overlapping inference, Crimson Desert remained running, and there were no concurrent builds or test suites during sampling. This is a real-model/worker comparison, not a Discord DOM/FPS benchmark or a comparison of two complete historical executables.

| Run order | Policy | Discord request completion | Web batch completion | All work completion |
| --- | --- | ---: | ---: | ---: |
| 1 | Uninterrupted | 12.342 s | 11.706 s | 12.342 s |
| 2 | Cooperative | 3.449 s | 12.610 s | 12.610 s |
| 3 | Cooperative | 3.511 s | 12.943 s | 12.943 s |
| 4 | Uninterrupted | 13.312 s | 12.644 s | 13.312 s |

Mean Discord completion decreased from 12.827 to 3.480 seconds (approximately 73%). Mean completion of all work was 12.827 versus 12.777 seconds. Mean web completion increased from 12.175 to 12.777 seconds (approximately 0.602 seconds, 4.9%) because Discord work was served before the web batch finished. Every corresponding web and Discord output was identical in this small corpus. This tradeoff is intentional and must not be described as making both completion times faster. A long single block, many competing requests, image/OCR work, or a different model can still cause latency; no universal queue-time bound is claimed. CPU worker counts/polling were not increased.

Reproduce only with desktop inference stopped and already-verified files (the test refuses a missing model):

```powershell
$env:NUDENYANG_SCHEDULER_SERVER = '<absolute packaged llama-server.exe path>'
$env:NUDENYANG_SCHEDULER_MODEL = '<absolute verified Hy-MT2 1.8B model path>'
cargo test --manifest-path src-tauri/Cargo.toml scheduling_live_cpu_model_latency_comparison -- --ignored --nocapture
```

Private reading and incognito use the same resumable scheduling with request-owned language evidence and an incognito memory cache. External CLI/API providers retain whole-batch calls to avoid increasing request counts; outgoing translation still has its existing separate worker. No web DOM selector, collection policy, outgoing editor, permission setting, or model prompt was changed.

### Final installed-app check

The rebuilt `0.7.5-beta` executable (SHA-256 `A5D13C05879866CCB4607184681D6393BAE73ADAB8FD2DEB49528678A62F8F25`) was started via the synchronized existing shortcut. The running path/version and child model CPU arguments were verified. The first build could not replace an executable held by respawned browser native hosts; only exact-path translator hosts were stopped, the old executable was retained as `nude-translator-tauri.before-fair-scheduler-b241ba3.exe` in the ignored release directory, and the repeated release build succeeded. Neither Discord nor the game was restarted.

`node scripts/verify-live-scheduling.mjs --run` sent four synthetic paragraphs through the actual Native Messaging host, running application, worker, and local model twice. Completion times were 12.168 and 12.284 seconds, all four IDs/results were complete, and both passes returned identical outputs. The report is generated under ignored `artifacts/scheduling-live-app.json`. This is an actual application/engine test, not an actual website DOM test.

During a concurrent 40.70-second observation, three ordinary Discord display requests had mean queue wait 1.303 seconds and maximum 1.550 seconds. Model CPU averaged 11.01% across active and idle time, with a busiest five-second interval of 18.46%; the main application averaged 0.74% and guardian 0.19%. These live conditions are not matched to the earlier 10.687-second observation, so they do not establish an exact live percentage improvement or a guaranteed delay ceiling. No matching application/model Windows Application Error event was observed after this launch.

`node scripts/verify-live-reading-bridge.mjs --run` also passed before and after installation: both synthetic three-item reading requests retained identical Korean outputs, and all three rejection cases passed. Actual emails/pages/drafts were not accessed and no Discord message was sent.

Final checks: `npm test` passed; `cargo test --manifest-path src-tauri/Cargo.toml` passed with 474 tests and 49 ignored; `npm run test:e2e` passed all 172 tests on the final implementation; `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `git diff --check`, and `node --check scripts/verify-live-scheduling.mjs` passed. The explicitly invoked real-model scheduler benchmark passed separately. Release build passed with the existing `LNK4098` warning. E2E uses synthetic browser fixtures/mock translation providers; public website samples were not rerun because DOM collection/application code was unchanged. Long-session stability, game FPS, other local model sizes/hardware, and external-provider latency remain unmeasured.
