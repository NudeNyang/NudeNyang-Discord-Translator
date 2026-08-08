$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$executable = Join-Path $installRoot 'NudeTranslatorDOM.exe'

if (-not (Test-Path -LiteralPath $executable)) {
    throw 'NudeTranslatorDOM.exe를 찾지 못했어.'
}

if (-not (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)) {
    $restartScript = Join-Path $installRoot 'Restart-Discord-Debug.ps1'
    if (-not (Test-Path -LiteralPath $restartScript)) {
        throw 'Discord DOM 연결 스크립트를 찾지 못했어.'
    }
    & $restartScript
}

$old = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -ieq 'NudeTranslatorDOM.exe' -and
        $_.ExecutablePath -eq $executable
    }
if ($old) {
    Write-Host 'Nude Translator DOM 모드가 이미 실행 중이야.'
    exit 0
}

Start-Process -FilePath $executable -WorkingDirectory $installRoot
