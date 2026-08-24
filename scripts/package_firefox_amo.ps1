param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ExtensionManifest = Join-Path $ProjectRoot 'extension\manifest.firefox.json'
$Manifest = Get-Content -Raw -LiteralPath $ExtensionManifest | ConvertFrom-Json
$Version = $Manifest.version

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectRoot 'release\browser-extension'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $ResolvedOutput -Force | Out-Null

& (Join-Path $PSScriptRoot 'package_firefox_extension.ps1') -OutputDirectory $ResolvedOutput | Out-Host
if ($LASTEXITCODE -notin @(0, $null)) {
    throw "Firefox 확장 패키지 생성에 실패했습니다: $LASTEXITCODE"
}

$SourceStaging = Join-Path $ProjectRoot 'dist\firefox-amo-source'
$ResolvedStaging = [System.IO.Path]::GetFullPath($SourceStaging)
if (-not $ResolvedStaging.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "프로젝트 밖의 AMO 소스 스테이징 경로는 정리할 수 없습니다: $ResolvedStaging"
}

Remove-Item -LiteralPath $ResolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ResolvedStaging -Force | Out-Null

$RootFiles = @('LICENSE', 'README.md', 'package.json')
foreach ($File in $RootFiles) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $File) -Destination $ResolvedStaging -Force
}

$Directories = @('extension', 'scripts', 'web', 'docs')
foreach ($Directory in $Directories) {
    New-Item -ItemType Directory -Path (Join-Path $ResolvedStaging $Directory) -Force | Out-Null
}

Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'extension') | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ResolvedStaging 'extension') -Recurse -Force
}

$ScriptFiles = @(
    'generate-extension-locales.mjs',
    'package_firefox_amo.ps1',
    'package_firefox_extension.ps1'
)
foreach ($File in $ScriptFiles) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "scripts\$File") -Destination (Join-Path $ResolvedStaging 'scripts') -Force
}

$WebFiles = @('i18n.mjs', 'ui-locales.mjs')
foreach ($File in $WebFiles) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "web\$File") -Destination (Join-Path $ResolvedStaging 'web') -Force
}

Copy-Item -LiteralPath (Join-Path $ProjectRoot 'docs\FIREFOX_AMO_REVIEW.md') -Destination (Join-Path $ResolvedStaging 'docs') -Force

$BaseName = "NudeNyang-Web-Translator-Firefox-$Version"
$SourceArchive = Join-Path $ResolvedOutput "$BaseName-source.zip"
$PackagePath = Join-Path $ResolvedOutput "$BaseName.xpi"
$ChecksumPath = Join-Path $ResolvedOutput "$BaseName-SHA256SUMS.txt"
Remove-Item -LiteralPath $SourceArchive, $ChecksumPath -Force -ErrorAction SilentlyContinue

# The built-in PowerShell archiver stores Windows separators in ZIP entry names.
# AMO rejects those entries, so write portable ZIP entry names explicitly.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ArchiveStream = [System.IO.File]::Open($SourceArchive, [System.IO.FileMode]::CreateNew)
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

$ChecksumLines = @($PackagePath, $SourceArchive) | ForEach-Object {
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant()
    "$Hash  $([System.IO.Path]::GetFileName($_))"
}
[System.IO.File]::WriteAllLines($ChecksumPath, $ChecksumLines, [System.Text.UTF8Encoding]::new($false))

Write-Host "Firefox AMO package: $PackagePath"
Write-Host "Firefox AMO source: $SourceArchive"
Write-Host "Firefox AMO checksums: $ChecksumPath"
Write-Output $PackagePath
Write-Output $SourceArchive
Write-Output $ChecksumPath
