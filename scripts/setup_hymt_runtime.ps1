$ErrorActionPreference = "Stop"

$ExistingServer = Get-Command llama-server -ErrorAction SilentlyContinue
if ($ExistingServer) {
    Write-Host "llama.cpp가 이미 설치되어 있어: $($ExistingServer.Source)"
    exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget을 찾지 못했어. Microsoft App Installer를 설치한 뒤 다시 실행해줘."
}

Write-Host "Hy-MT2 실행용 llama.cpp를 설치할게."
winget install --id ggml.llamacpp --exact --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    throw "llama.cpp 설치에 실패했어(exit code: $LASTEXITCODE)."
}

Write-Host "설치가 끝났어. 실행 중인 Nude Translator를 완전히 종료한 뒤 다시 켜줘."
