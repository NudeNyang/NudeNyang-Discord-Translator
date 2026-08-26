param(
    [Parameter(Mandatory = $true)]
    [string]$PreviousVersion,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ManifestPath = Join-Path $ProjectRoot 'extension\manifest.json'
$CurrentVersion = (Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json).version

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectRoot 'release\browser-extension'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$ExpectedOutput = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'release\browser-extension'))
if ($ResolvedOutput -ne $ExpectedOutput) {
    throw "브라우저 산출물 정리는 지정된 release 폴더에서만 실행할 수 있습니다: $ResolvedOutput"
}

$ArtifactPattern = '^NudeNyang-Web-Translator-(?:Chromium|Firefox)-(?<version>\d+\.\d+\.\d+)(?:-source|-SHA256SUMS)?\.(?:zip|xpi|txt)$'
$KeepVersions = @($CurrentVersion, $PreviousVersion)
$Removed = [System.Collections.Generic.List[string]]::new()

Get-ChildItem -LiteralPath $ResolvedOutput -File | ForEach-Object {
    if ($_.Name -notmatch $ArtifactPattern) {
        return
    }
    if ($KeepVersions -contains $Matches.version) {
        return
    }

    $ResolvedTarget = [System.IO.Path]::GetFullPath($_.FullName)
    if ([System.IO.Path]::GetDirectoryName($ResolvedTarget) -ne $ResolvedOutput) {
        throw "정리 대상이 브라우저 산출물 폴더 밖에 있습니다: $ResolvedTarget"
    }

    Remove-Item -LiteralPath $ResolvedTarget -Force
    $Removed.Add($_.Name)
}

Write-Host "Kept browser extension versions: $($KeepVersions -join ', ')"
Write-Host "Removed browser extension artifacts: $($Removed.Count)"
$Removed | Sort-Object
