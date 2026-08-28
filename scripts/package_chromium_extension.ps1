param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ExtensionDirectory = Join-Path $ProjectRoot 'extension'
$StagingDirectory = Join-Path $ProjectRoot 'dist\chromium-store-extension'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectRoot 'release\browser-extension'
}

$ResolvedStaging = [System.IO.Path]::GetFullPath($StagingDirectory)
if (-not $ResolvedStaging.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "프로젝트 밖의 Chromium 스테이징 경로는 정리할 수 없습니다: $ResolvedStaging"
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

$DevelopmentManifest = Get-Content -Raw -LiteralPath (Join-Path $ExtensionDirectory 'manifest.json') |
    ConvertFrom-Json
if (-not $DevelopmentManifest.key) {
    throw '개발용 Chromium 매니페스트에 확장 ID를 고정할 공개 키가 없습니다.'
}
$Identities = Get-Content -Raw -LiteralPath (Join-Path $ExtensionDirectory 'chromium-identities.json') |
    ConvertFrom-Json
if ($DevelopmentManifest.key -ne $Identities.store.publicKey) {
    throw 'Chromium 원본 매니페스트의 공개 키가 스토어 ID 설정과 일치하지 않습니다.'
}
$DevelopmentManifest.PSObject.Properties.Remove('key')
$StoreManifestPath = Join-Path $ResolvedStaging 'manifest.json'
$StoreManifestJson = $DevelopmentManifest | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText(
    $StoreManifestPath,
    $StoreManifestJson + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)

$StoreManifest = Get-Content -Raw -LiteralPath $StoreManifestPath | ConvertFrom-Json
if ($StoreManifest.PSObject.Properties.Name -contains 'key') {
    throw 'Chrome 웹 스토어 패키지 매니페스트에서 개발용 key를 제거하지 못했습니다.'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $ResolvedOutput -Force | Out-Null
$BaseName = "NudeNyang-Web-Translator-Chromium-$($StoreManifest.version)"
$PackagePath = Join-Path $ResolvedOutput "$BaseName.zip"
Remove-Item -LiteralPath $PackagePath -Force -ErrorAction SilentlyContinue

# Chrome Web Store와 다른 Chromium 스토어가 모든 ZIP 항목을 동일하게 읽도록
# Windows 경로 구분자 대신 이식 가능한 슬래시를 사용한다.
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

Write-Host "Chromium store extension package: $PackagePath"
Write-Output $PackagePath
