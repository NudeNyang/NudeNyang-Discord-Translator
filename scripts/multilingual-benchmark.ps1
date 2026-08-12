param(
    [ValidateSet("Detection", "Translation", "Ocr", "All")]
    [string]$Mode = "Detection",
    [string]$OutputDirectory = "artifacts/multilingual-benchmark"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$reportDirectory = Join-Path $repositoryRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null

if ($Mode -in @("Detection", "All")) {
    $env:NUDE_TRANSLATOR_BENCHMARK_REPORT = Join-Path $reportDirectory "language-detection.md"
    try {
        & cargo test --manifest-path (Join-Path $repositoryRoot "src-tauri/Cargo.toml") multilingual_detection_benchmark -- --nocapture
        if ($LASTEXITCODE -ne 0) { throw "Multilingual detection benchmark failed." }
    } finally {
        Remove-Item Env:NUDE_TRANSLATOR_BENCHMARK_REPORT -ErrorAction SilentlyContinue
    }
}

if ($Mode -in @("Translation", "All")) {
    $env:NUDE_TRANSLATOR_TRANSLATION_REPORT = Join-Path $reportDirectory "hymt-1.8b-translation.md"
    try {
        & cargo test --manifest-path (Join-Path $repositoryRoot "src-tauri/Cargo.toml") multilingual_translation_benchmark -- --ignored --nocapture
        if ($LASTEXITCODE -ne 0) { throw "Multilingual translation benchmark failed." }
    } finally {
        Remove-Item Env:NUDE_TRANSLATOR_TRANSLATION_REPORT -ErrorAction SilentlyContinue
    }
}

if ($Mode -in @("Ocr", "All")) {
    $env:NUDE_TRANSLATOR_OCR_REPORT = Join-Path $reportDirectory "ocr-coverage.md"
    try {
        & cargo test --manifest-path (Join-Path $repositoryRoot "src-tauri/Cargo.toml") ocr_language_coverage_report -- --ignored --nocapture
        if ($LASTEXITCODE -ne 0) { throw "OCR language coverage audit failed." }
    } finally {
        Remove-Item Env:NUDE_TRANSLATOR_OCR_REPORT -ErrorAction SilentlyContinue
    }
}

Write-Host "Report: $reportDirectory"
