$ErrorActionPreference = 'Stop'
$port = 9222
$discord = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -ieq 'Discord.exe' -and $_.ExecutablePath } |
    Select-Object -First 1

if (-not $discord) {
    $app = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\Discord" -Directory |
        Where-Object { $_.Name -like 'app-*' } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $app) { throw 'Discord 설치 폴더를 찾지 못했어.' }
    $discordExe = Join-Path $app.FullName 'Discord.exe'
} else {
    $discordExe = $discord.ExecutablePath
}

Get-Process -Name Discord -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
Start-Process -FilePath $discordExe -ArgumentList @(
    '--force-renderer-accessibility',
    "--remote-debugging-port=$port"
)

$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 300
    try {
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1
        if ($targets) {
            Write-Host "Nude Translator DOM 연결 준비 완료 (127.0.0.1:$port)"
            exit 0
        }
    } catch { }
} while ((Get-Date) -lt $deadline)

throw 'Discord가 열렸지만 DOM 디버그 포트가 준비되지 않았어.'
