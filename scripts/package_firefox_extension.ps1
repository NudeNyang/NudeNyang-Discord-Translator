param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ExtensionDirectory = Join-Path $ProjectRoot 'extension'
$StagingDirectory = Join-Path $ProjectRoot 'dist\firefox-extension'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectRoot 'release\browser-extension'
}

$ResolvedStaging = [System.IO.Path]::GetFullPath($StagingDirectory)
if (-not $ResolvedStaging.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "프로젝트 밖의 Firefox 확장 스테이징 경로는 정리할 수 없습니다: $ResolvedStaging"
}

Remove-Item -LiteralPath $ResolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ResolvedStaging -Force | Out-Null

$SharedFiles = @(
    'background.js',
    'content-helpers.js',
    'content.js',
    'native-client.js',
    'popup.css',
    'popup.html',
    'popup.js',
    'site-adapters.js'
)
foreach ($File in $SharedFiles) {
    Copy-Item -LiteralPath (Join-Path $ExtensionDirectory $File) -Destination $ResolvedStaging -Force
}
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory 'icons') -Destination $ResolvedStaging -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory 'manifest.firefox.json') -Destination (Join-Path $ResolvedStaging 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination (Join-Path $ResolvedStaging 'LICENSE.txt') -Force

$Manifest = Get-Content -Raw -LiteralPath (Join-Path $ResolvedStaging 'manifest.json') | ConvertFrom-Json
if ($Manifest.browser_specific_settings.gecko.id -ne 'web-translator@nudenyang.github.io') {
    throw 'Firefox 확장 Add-on ID가 Native Messaging 허용 ID와 일치하지 않습니다.'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $ResolvedOutput -Force | Out-Null
$BaseName = "NudeNyang-Web-Translator-Firefox-$($Manifest.version)"
$TemporaryZip = Join-Path $ResolvedOutput "$BaseName.zip"
$PackagePath = Join-Path $ResolvedOutput "$BaseName.xpi"
Remove-Item -LiteralPath $TemporaryZip, $PackagePath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $ResolvedStaging '*') -DestinationPath $TemporaryZip -CompressionLevel Optimal
Move-Item -LiteralPath $TemporaryZip -Destination $PackagePath -Force

Write-Host "Firefox extension package: $PackagePath"
Write-Output $PackagePath
