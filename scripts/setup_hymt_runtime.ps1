$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'verify_llama_runtime.ps1')

$WingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$ExistingServer = Get-ChildItem $WingetPackages -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\ggml.llamacpp_Microsoft.Winget.Source_*\llama-server.exe' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if ($ExistingServer) {
    Assert-LlamaRuntimeVerified -SourceDirectory $ExistingServer.DirectoryName
    Write-Host "WinGet llama.cpp가 이미 설치되어 있습니다: $($ExistingServer.FullName)"
    exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget을 찾지 못했습니다. Microsoft App Installer를 설치한 후 다시 실행하십시오."
}

Write-Host "Hy-MT2 실행용 llama.cpp를 설치합니다."
winget install --id ggml.llamacpp --exact --version b10236 --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    throw "llama.cpp 설치에 실패했습니다(exit code: $LASTEXITCODE)."
}

$InstalledServer = Get-ChildItem $WingetPackages -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\ggml.llamacpp_Microsoft.Winget.Source_*\llama-server.exe' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $InstalledServer) {
    throw '설치 후 WinGet llama.cpp 런타임을 찾지 못했습니다.'
}
Assert-LlamaRuntimeVerified -SourceDirectory $InstalledServer.DirectoryName

Write-Host "설치가 완료되었습니다. 실행 중인 NudeNyang Discord Translator를 완전히 종료한 후 다시 실행하십시오."
