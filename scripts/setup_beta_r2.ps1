param(
    [string]$BucketName = 'nude-translator-beta-releases',
    [string]$WorkerDirectory = 'infra\update-worker'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$WorkerPath = Join-Path $ProjectRoot $WorkerDirectory
$SecretDirectory = Join-Path $env:LOCALAPPDATA 'NudeTranslator\secrets'
$TokenFile = Join-Path $SecretDirectory 'beta-token.txt'
$EndpointFile = Join-Path $SecretDirectory 'update-endpoint.txt'
$InviteFile = Join-Path $SecretDirectory 'beta-invite-link.txt'
New-Item -ItemType Directory -Path $SecretDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $TokenFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Content -LiteralPath $TokenFile -Value $token -Encoding ascii -NoNewline
    icacls $TokenFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
}
$BetaToken = (Get-Content -Raw -LiteralPath $TokenFile).Trim()

Push-Location $WorkerPath
try {
    $env:NO_COLOR = '1'
    $buckets = npx wrangler r2 bucket list 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($buckets -join "`n") }
    if (($buckets -join "`n") -notmatch [regex]::Escape($BucketName)) {
        npx wrangler r2 bucket create $BucketName
        if ($LASTEXITCODE -ne 0) { throw 'R2 베타 릴리스 버킷을 만들지 못했습니다.' }
    }
    $deployOutput = npx wrangler deploy 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($deployOutput -join "`n") }
    $workerUrl = [regex]::Match(($deployOutput -join "`n"), 'https://[a-zA-Z0-9.-]+\.workers\.dev').Value
    if (-not $workerUrl) { throw '배포된 Worker 주소를 찾지 못했습니다.' }
    $BetaToken | npx wrangler secret put BETA_TOKENS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Worker 베타 토큰을 등록하지 못했습니다.' }
}
finally {
    Pop-Location
}

$Endpoint = "$workerUrl/v1/update/{{target}}/{{arch}}/{{current_version}}"
$InviteLink = "$workerUrl/v1/install?code=$([Uri]::EscapeDataString($BetaToken))"
Set-Content -LiteralPath $EndpointFile -Value $Endpoint -Encoding ascii -NoNewline
Set-Content -LiteralPath $InviteFile -Value $InviteLink -Encoding ascii -NoNewline
icacls $EndpointFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
icacls $InviteFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "업데이트 Worker: $workerUrl"
Write-Host "업데이트 주소 저장: $EndpointFile"
Write-Host "친구 초대 링크 저장: $InviteFile"
