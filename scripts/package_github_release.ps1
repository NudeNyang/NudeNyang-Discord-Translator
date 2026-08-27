param(
    [string]$Repository = 'NudeNyang/NudeNyang-Discord-Translator',
    [string]$ReleaseNotesPath,
    [switch]$IncludeDefaultModel,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$TauriConfigPath = Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'
$TauriConfig = [IO.File]::ReadAllText($TauriConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Version = [string]$TauriConfig.version
if ($Repository -ne 'NudeNyang/NudeNyang-Discord-Translator') { throw '기존 공개 업데이트 저장소와 주소를 유지해야 합니다.' }
if ($IncludeDefaultModel) { throw '공개 설치형은 모델을 포함하지 않습니다. 모델은 앱에서 다운로드하십시오.' }
if (-not $ReleaseNotesPath) { $ReleaseNotesPath = Join-Path $ProjectRoot "docs\releases\$Version.md" }
if (-not (Test-Path -LiteralPath $ReleaseNotesPath -PathType Leaf)) { throw "릴리스 노트가 없습니다: $ReleaseNotesPath" }
if (-not ([IO.File]::ReadAllText($ReleaseNotesPath, [Text.Encoding]::UTF8)).Trim()) { throw '릴리스 노트가 비어 있습니다.' }

# Never generate/replace a signing key while packaging an existing product.
$SecretDirectory = Join-Path $env:LOCALAPPDATA 'NudeNyang Discord Translator\secrets'
$PrivateKeyPath = Join-Path $SecretDirectory 'updater.key'
$PasswordPath = Join-Path $SecretDirectory 'updater-password.txt'
foreach ($path in @($PrivateKeyPath, $PasswordPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "기존 업데이트 서명 파일이 없습니다: $path" }
}

Push-Location $ProjectRoot
try {
    if (git status --porcelain) { throw '패키징 전에 소스·버전·릴리스 문서 변경을 커밋하십시오.' }
    $SourceCommit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw '빌드 소스 커밋을 확인하지 못했습니다.' }
    $ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
    $Installers = @('x64', 'ARM64') | ForEach-Object { Join-Path $ReleaseDirectory "NudeNyang-Translator-$Version-$_-Setup.exe" }
    $BuildReceiptPath = Join-Path $ReleaseDirectory 'windows-build.json'
    if ($SkipBuild) {
        if (-not (Test-Path -LiteralPath $BuildReceiptPath -PathType Leaf)) { throw '동일 소스의 두 설치형 빌드 기록이 없습니다. SkipBuild 없이 실행하십시오.' }
        $BuildReceipt = [IO.File]::ReadAllText($BuildReceiptPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($BuildReceipt.source_commit -ne $SourceCommit -or $BuildReceipt.version -ne $Version) { throw '이전 설치형의 소스 커밋·버전이 다릅니다. 다시 빌드하십시오.' }
        foreach ($installer in $Installers) {
            $name = [IO.Path]::GetFileName($installer)
            if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $BuildReceipt.installers.$name) { throw "기존 빌드와 설치 파일이 다릅니다: $name" }
        }
    }
    else {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'package_windows_variants.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Windows x64·ARM64 설치형 생성에 실패했습니다.' }
        if ((git rev-parse HEAD).Trim() -ne $SourceCommit -or (git status --porcelain)) { throw '빌드 중 소스가 변경되었습니다. 다시 빌드하십시오.' }
        $InstallerHashes = [ordered]@{}
        foreach ($installer in $Installers) { $InstallerHashes[[IO.Path]::GetFileName($installer)] = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash }
        $BuildReceipt = [ordered]@{ source_commit = $SourceCommit; version = $Version; installers = $InstallerHashes }
        [IO.File]::WriteAllText($BuildReceiptPath, ($BuildReceipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    }
    foreach ($installer in $Installers) {
        if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "설치 파일이 없습니다: $installer" }
    }
    $PreviousSigningEnvironment = @{}
    foreach ($name in @('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD')) {
        $PreviousSigningEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        $env:TAURI_SIGNING_PRIVATE_KEY = $null
        $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $PrivateKeyPath
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ([IO.File]::ReadAllText($PasswordPath)).Trim()
        foreach ($installer in $Installers) {
            npm run tauri -- signer sign $installer
            if ($LASTEXITCODE -ne 0) { throw "업데이트 서명에 실패했습니다: $installer" }
        }
    }
    finally {
        foreach ($name in $PreviousSigningEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $PreviousSigningEnvironment[$name], 'Process')
        }
    }
    node (Join-Path $PSScriptRoot 'release-updates.mjs') generate --project-root $ProjectRoot --notes-file $ReleaseNotesPath --commit $SourceCommit
    if ($LASTEXITCODE -ne 0) { throw '두 아키텍처의 서명·업데이트 목록 검증에 실패했습니다.' }
}
finally { Pop-Location }

Write-Host '두 설치형·서명·체크섬·업데이트 목록을 로컬에 생성했습니다. 공개 업데이트 주소는 아직 변경하지 않았습니다.'
