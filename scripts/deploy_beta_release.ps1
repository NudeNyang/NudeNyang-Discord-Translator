param(
    [string]$Version = '0.5.0-beta',
    [string]$BucketName = 'nude-translator-beta-releases'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
$ManifestPath = Join-Path $ReleaseDirectory 'latest.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "베타 업데이트 매니페스트가 없습니다: $ManifestPath"
}
$Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$InstallerPath = Join-Path $ReleaseDirectory ([IO.Path]::GetFileName([string]$Manifest.installer_object_key))
if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "베타 설치 파일이 없습니다: $InstallerPath"
}

Push-Location (Join-Path $ProjectRoot 'infra\update-worker')
try {
    npx wrangler r2 object put "$BucketName/$($Manifest.installer_object_key)" --remote --file $InstallerPath --content-type 'application/vnd.microsoft.portable-executable' --cache-control 'private, no-store'
    if ($LASTEXITCODE -ne 0) { throw '베타 설치 파일을 R2에 올리지 못했습니다.' }
    npx wrangler r2 object put "$BucketName/beta/latest.json" --remote --file $ManifestPath --content-type 'application/json' --cache-control 'private, no-store'
    if ($LASTEXITCODE -ne 0) { throw '베타 업데이트 매니페스트를 R2에 올리지 못했습니다.' }
}
finally {
    Pop-Location
}

$SecretDirectory = Join-Path $env:LOCALAPPDATA 'NudeTranslator\secrets'
$Endpoint = (Get-Content -Raw -LiteralPath (Join-Path $SecretDirectory 'update-endpoint.txt')).Trim()
$BetaToken = (Get-Content -Raw -LiteralPath (Join-Path $SecretDirectory 'beta-token.txt')).Trim()
$CheckUrl = $Endpoint.Replace('{{target}}', 'windows').Replace('{{arch}}', 'x86_64').Replace('{{current_version}}', '0.0.0')
$Response = Invoke-WebRequest -Uri $CheckUrl -Headers @{ Authorization = "Bearer $BetaToken" } -UseBasicParsing
if ($Response.StatusCode -ne 200) { throw "배포 확인이 실패했습니다(HTTP $($Response.StatusCode))." }
$Remote = $Response.Content | ConvertFrom-Json
if ([string]$Remote.version -ne $Version) { throw "배포 버전이 일치하지 않습니다: $($Remote.version)" }
Write-Host "R2 베타 배포 확인 완료: $Version"
