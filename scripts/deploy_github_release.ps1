param(
    [string]$Version,
    [string]$Repository = 'NudeNyang/NudeNyang-Discord-Translator',
    [string]$ReleaseNotesPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
if (-not $Version) {
    $TauriConfigPath = Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'
    $TauriConfig = [IO.File]::ReadAllText($TauriConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $Version = [string]$TauriConfig.version
}
if (-not $ReleaseNotesPath) {
    $ReleaseNotesPath = Join-Path $ProjectRoot "docs\releases\$Version.md"
}
$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
$InstallerName = "NudeNyangDiscordTranslator-$Version-Windows-x64-Setup.exe"
$InstallerPath = Join-Path $ReleaseDirectory $InstallerName
$SignaturePath = "$InstallerPath.sig"
$ManifestPath = Join-Path $ReleaseDirectory 'latest.json'
$ChecksumPath = Join-Path $ReleaseDirectory 'SHA256SUMS.txt'
foreach ($requiredPath in @($ReleaseNotesPath, $InstallerPath, $SignaturePath, $ManifestPath, $ChecksumPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "GitHub 릴리스에 필요한 파일이 없습니다: $requiredPath"
    }
}

Push-Location $ProjectRoot
try {
    $status = git status --porcelain
    if ($status) {
        throw 'GitHub 릴리스 전 Git 작업 트리를 커밋하십시오.'
    }
    git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'origin/main을 확인하지 못했습니다.' }
    $localCommit = (git rev-parse HEAD).Trim()
    $remoteCommit = (git rev-parse origin/main).Trim()
    if ($localCommit -ne $remoteCommit) {
        throw "로컬 main과 origin/main이 일치하지 않습니다: $localCommit / $remoteCommit"
    }

    gh release create "v$Version" `
        $InstallerPath `
        $SignaturePath `
        $ManifestPath `
        $ChecksumPath `
        --repo $Repository `
        --title "NudeNyang Discord Translator $Version - Open Beta" `
        --notes-file $ReleaseNotesPath `
        --latest `
        --target main
    if ($LASTEXITCODE -ne 0) { throw 'GitHub 오픈 베타 릴리스를 게시하지 못했습니다.' }
}
finally {
    Pop-Location
}

Write-Host "GitHub 오픈 베타 릴리스 게시 완료: v$Version"
