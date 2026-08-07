$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot '.venv\Scripts\pythonw.exe'

if (-not (Test-Path -LiteralPath $python)) {
    throw '프로젝트 가상환경을 찾지 못했어. 먼저 설치를 완료해줘.'
}

if (-not (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)) {
    & (Join-Path $PSScriptRoot 'restart_discord_debug.ps1')
}

$old = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in @('python.exe', 'pythonw.exe') -and
        $_.CommandLine -like '*discord_translate_overlay.experimental_dom.controller*'
    }
if ($old) {
    Write-Host 'Nude Translator가 이미 실행 중이야.'
    exit 0
}

Start-Process -FilePath $python `
    -ArgumentList @('-m', 'discord_translate_overlay.experimental_dom.controller') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden
