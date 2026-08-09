$ErrorActionPreference = "Stop"

$ExistingServer = Get-Command llama-server -ErrorAction SilentlyContinue
if ($ExistingServer) {
    Write-Host "llama.cpp가 이미 설치되어 있습니다: $($ExistingServer.Source)"
    exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget을 찾지 못했습니다. Microsoft App Installer를 설치한 후 다시 실행하십시오."
}

Write-Host "Hy-MT2 실행용 llama.cpp를 설치합니다."
winget install --id ggml.llamacpp --exact --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    throw "llama.cpp 설치에 실패했습니다(exit code: $LASTEXITCODE)."
}

Write-Host "설치가 완료되었습니다. 실행 중인 NudeNyang Translator를 완전히 종료한 후 다시 실행하십시오."
