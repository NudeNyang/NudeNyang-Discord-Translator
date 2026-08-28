param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ExtensionDirectory = Join-Path $ProjectRoot 'extension'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectRoot 'dist\chromium-personal-extension'
}

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $ResolvedOutput.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "프로젝트 밖의 개인용 Chromium 확장 폴더는 정리할 수 없습니다: $ResolvedOutput"
}
Remove-Item -LiteralPath $ResolvedOutput -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ResolvedOutput -Force | Out-Null

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
    Copy-Item -LiteralPath (Join-Path $ExtensionDirectory $File) -Destination $ResolvedOutput -Force
}
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory 'icons') -Destination $ResolvedOutput -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ExtensionDirectory '_locales') -Destination $ResolvedOutput -Recurse -Force

$Identities = Get-Content -Raw -LiteralPath (Join-Path $ExtensionDirectory 'chromium-identities.json') |
    ConvertFrom-Json
$StoreIdentity = $Identities.store
$PersonalIdentity = $Identities.personal
$Manifest = Get-Content -Raw -LiteralPath (Join-Path $ExtensionDirectory 'manifest.json') |
    ConvertFrom-Json
if ($Manifest.key -ne $StoreIdentity.publicKey) {
    throw 'Chromium 원본 매니페스트의 공개 키가 스토어 ID 설정과 일치하지 않습니다.'
}
$Manifest.key = $PersonalIdentity.publicKey

function Get-ChromiumExtensionId {
    param([Parameter(Mandatory)][string]$PublicKey)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash([Convert]::FromBase64String($PublicKey))
    }
    finally {
        $sha256.Dispose()
    }
    $alphabet = 'abcdefghijklmnop'
    $builder = [Text.StringBuilder]::new(32)
    foreach ($byte in $hash[0..15]) {
        [void]$builder.Append($alphabet[$byte -shr 4])
        [void]$builder.Append($alphabet[$byte -band 0x0F])
    }
    return $builder.ToString()
}

$CalculatedId = Get-ChromiumExtensionId -PublicKey $Manifest.key
if ($CalculatedId -ne $PersonalIdentity.extensionId) {
    throw "개인용 Chromium 확장 ID가 설정과 일치하지 않습니다: $CalculatedId"
}

$ManifestJson = $Manifest | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText(
    (Join-Path $ResolvedOutput 'manifest.json'),
    $ManifestJson + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Personal Chromium extension: $ResolvedOutput"
Write-Host "Personal Chromium extension ID: $CalculatedId"
Write-Output $ResolvedOutput
