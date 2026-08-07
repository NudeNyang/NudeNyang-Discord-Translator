param(
    [ValidateSet("Auto", "Gpu", "Cpu")]
    [string]$Device = "Auto"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot "runtime\kanana"

if ($Device -eq "Auto") {
    $NvidiaGpu = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    $Device = if ($null -ne $NvidiaGpu) { "Gpu" } else { "Cpu" }
}

$Extra = $Device.ToLowerInvariant()
Write-Host "Kanana 전용 $Device 런타임을 설치해. OCR 환경과 CUDA DLL을 공유하지 않아."
uv sync --project $RuntimeRoot --extra $Extra
if ($LASTEXITCODE -ne 0) {
    throw "Kanana 런타임 설치 실패 (exit code: $LASTEXITCODE)"
}

$RuntimePython = Join-Path $RuntimeRoot ".venv\Scripts\python.exe"
& $RuntimePython -c "import bitsandbytes, torch, transformers; print('torch', torch.__version__); print('transformers', transformers.__version__); print('bitsandbytes', bitsandbytes.__version__); print('cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) {
    throw "Kanana 런타임 자체 검사 실패 (exit code: $LASTEXITCODE)"
}

Write-Host "설치 완료: $RuntimePython"
