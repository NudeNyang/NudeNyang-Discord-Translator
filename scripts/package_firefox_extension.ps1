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
    'connection-guidance.js',
    'download.html',
    'download.css',
    'download.js',
    'download-feed.js',
    'background.js',
    'content-helpers.js',
    'dom-policy.js',
    'translation-audit.js',
    'text-segments.js',
    'content.js',
    'embedded-bridge.js',
    'embedded-title.js',
    'messenger-adapters.js',
    'messenger-privacy.js',
    'messenger-privacy.html',
    'messenger-privacy-page.js',
    'messenger-privacy.css',
    'native-client.js',
    'page-connection.js',
    'popup.css',
    'popup.html',
    'popup-locales.js',
    'popup.js',
    'site-adapters.js',
    'tab-state.js'
)
foreach ($File in $SharedFiles) {
    Copy-Item -LiteralPath (Join-Path $ExtensionDirectory $File) -Destination $ResolvedStaging -Force
}
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory 'icons') -Destination $ResolvedStaging -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory '_locales') -Destination $ResolvedStaging -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory 'manifest.firefox.json') -Destination (Join-Path $ResolvedStaging 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination (Join-Path $ResolvedStaging 'LICENSE.txt') -Force

$Manifest = Get-Content -Raw -LiteralPath (Join-Path $ResolvedStaging 'manifest.json') | ConvertFrom-Json
if ($Manifest.browser_specific_settings.gecko.id -ne 'web-translator@nudenyang.github.io') {
    throw 'Firefox 확장 Add-on ID가 Native Messaging 허용 ID와 일치하지 않습니다.'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $ResolvedOutput -Force | Out-Null
$BaseName = "NudeNyang-Web-Translator-Firefox-$($Manifest.version)"
$PackagePath = Join-Path $ResolvedOutput "$BaseName.xpi"
Remove-Item -LiteralPath $PackagePath -Force -ErrorAction SilentlyContinue

# AMO requires forward slashes in every XPI entry name, including nested icons
# and locale files. Write the archive directly instead of using Windows paths.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ArchiveStream = [System.IO.File]::Open($PackagePath, [System.IO.FileMode]::CreateNew)
try {
    $Archive = [System.IO.Compression.ZipArchive]::new(
        $ArchiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
    )
    try {
        Get-ChildItem -LiteralPath $ResolvedStaging -Recurse -File |
            Sort-Object FullName |
            ForEach-Object {
                $RelativePath = $_.FullName.Substring($ResolvedStaging.Length).TrimStart([char[]]'\/')
                $EntryName = $RelativePath.Replace('\', '/')
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $Archive,
                    $_.FullName,
                    $EntryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
    }
    finally {
        $Archive.Dispose()
    }
}
finally {
    $ArchiveStream.Dispose()
}

Write-Host "Firefox extension package: $PackagePath"
Write-Output $PackagePath
