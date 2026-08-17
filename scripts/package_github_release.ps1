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
$Tag = "v$Version"
$UpdateEndpoint = "https://raw.githubusercontent.com/$Repository/main/updates/beta/latest.json"

if (-not $ReleaseNotesPath) {
    $ReleaseNotesPath = Join-Path $ProjectRoot "docs\releases\$Version.md"
}
if (-not (Test-Path -LiteralPath $ReleaseNotesPath)) {
    throw "GitHub 릴리스 노트가 없습니다: $ReleaseNotesPath"
}
$ReleaseNotes = ([IO.File]::ReadAllText($ReleaseNotesPath, [Text.Encoding]::UTF8)).Trim()
if (-not $ReleaseNotes) {
    throw "GitHub 릴리스 노트가 비어 있습니다: $ReleaseNotesPath"
}

$packageArguments = @(
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'package_beta.ps1'),
    '-UpdateEndpoint', $UpdateEndpoint,
    '-ReleaseNotes', $ReleaseNotes,
    '-PublicUpdater'
)
if ($IncludeDefaultModel) { $packageArguments += '-IncludeDefaultModel' }
if ($SkipBuild) { $packageArguments += '-SkipBuild' }
& powershell.exe @packageArguments
if ($LASTEXITCODE -ne 0) {
    throw "GitHub 오픈 베타 설치 파일 생성에 실패했습니다(exit code: $LASTEXITCODE)."
}

$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
$InstallerName = "NudeNyangDiscordTranslator-$Version-Windows-x64-Setup.exe"
$InstallerPath = Join-Path $ReleaseDirectory $InstallerName
$SignaturePath = "$InstallerPath.sig"
foreach ($requiredPath in @($InstallerPath, $SignaturePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "GitHub 릴리스 파일이 없습니다: $requiredPath"
    }
}

$ArtifactUrl = "https://github.com/$Repository/releases/download/$Tag/$InstallerName"
$Manifest = [ordered]@{
    version = $Version
    notes = $ReleaseNotes
    pub_date = [DateTime]::UtcNow.ToString('o')
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{
            signature = ([IO.File]::ReadAllText($SignaturePath, [Text.Encoding]::UTF8)).Trim()
            url = $ArtifactUrl
        }
    }
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 6
$ReleaseManifestPath = Join-Path $ReleaseDirectory 'latest.json'
$ChecksumPath = Join-Path $ReleaseDirectory 'SHA256SUMS.txt'
$TrackedManifestPath = Join-Path $ProjectRoot 'updates\beta\latest.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $TrackedManifestPath) -Force | Out-Null
[IO.File]::WriteAllText($ReleaseManifestPath, $ManifestJson, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($TrackedManifestPath, $ManifestJson, [Text.UTF8Encoding]::new($false))
$Checksum = "{0}  {1}`n" -f ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()), $InstallerName
[IO.File]::WriteAllText($ChecksumPath, $Checksum, [Text.UTF8Encoding]::new($false))

Write-Host "GitHub 오픈 베타 설치 파일: $InstallerPath"
Write-Host "GitHub 업데이트 매니페스트: $TrackedManifestPath"
Write-Host "SHA-256 체크섬: $ChecksumPath"
Write-Host "앱 업데이트 주소: $UpdateEndpoint"
