param(
    [switch]$Clean,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if ($Clean) {
    if ((Resolve-Path $ProjectRoot).Path -ne (Get-Location).Path) {
        throw "패키징 작업 폴더 확인 실패"
    }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$ProjectRoot\build"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$ProjectRoot\dist"
}

if (-not $SkipBuild) {
    uv run python -m PyInstaller `
    --noconfirm `
    --windowed `
    --name NudeTranslator `
    --icon "$ProjectRoot\assets\nude-translator.ico" `
    --collect-all paddle `
    --collect-all paddleocr `
    --collect-all paddlex `
    --collect-all pypdfium2 `
    --collect-all nvidia.cublas `
    --collect-all nvidia.cuda_nvrtc `
    --collect-all nvidia.cuda_runtime `
    --collect-all nvidia.cudnn `
    --exclude-module torch `
    --exclude-module transformers `
    --exclude-module bitsandbytes `
    --exclude-module accelerate `
    --copy-metadata imagesize `
    --copy-metadata opencv-contrib-python `
    --copy-metadata pyclipper `
    --copy-metadata pypdfium2 `
    --copy-metadata python-bidi `
    --copy-metadata shapely `
    --hidden-import win32timezone `
    --paths "$ProjectRoot\src" `
        "$ProjectRoot\scripts\run_app.py"

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller 패키징 실패 (exit code: $LASTEXITCODE)"
    }

}

$MainExecutable = Join-Path $ProjectRoot 'dist\NudeTranslator\NudeTranslator.exe'
if (-not (Test-Path -LiteralPath $MainExecutable)) {
    throw 'NudeTranslator.exe가 없어 릴리스 패키지를 완성할 수 없어.'
}
$DomExecutable = Join-Path $ProjectRoot 'dist\NudeTranslator\NudeTranslatorDOM.exe'
Copy-Item -LiteralPath $MainExecutable -Destination $DomExecutable
Copy-Item -LiteralPath "$ProjectRoot\scripts\start_packaged_dom.ps1" `
    -Destination "$ProjectRoot\dist\NudeTranslator\Start-NudeTranslatorDOM.ps1"
Copy-Item -LiteralPath "$ProjectRoot\scripts\restart_discord_debug.ps1" `
    -Destination "$ProjectRoot\dist\NudeTranslator\Restart-Discord-Debug.ps1"
Copy-Item -LiteralPath "$ProjectRoot\LICENSE" `
    -Destination "$ProjectRoot\dist\NudeTranslator\LICENSE.txt"
Copy-Item -LiteralPath "$ProjectRoot\THIRD_PARTY_NOTICES.md" `
    -Destination "$ProjectRoot\dist\NudeTranslator\THIRD_PARTY_NOTICES.md"
$LicenseDestination = "$ProjectRoot\dist\NudeTranslator\licenses"
New-Item -ItemType Directory -Force $LicenseDestination | Out-Null
Copy-Item -LiteralPath "$ProjectRoot\licenses\Hy-MT2-1.8B-GGUF-LICENSE.txt" `
    -Destination $LicenseDestination
Copy-Item -LiteralPath "$ProjectRoot\licenses\Hy-MT2-7B-GGUF-LICENSE.txt" `
    -Destination $LicenseDestination

$LlamaCommand = Get-Command llama-server -ErrorAction SilentlyContinue
$LlamaPath = if ($LlamaCommand) { $LlamaCommand.Source } else { $null }
if (-not $LlamaPath) {
    $WingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $LlamaPath = Get-ChildItem $WingetPackages -Filter llama-server.exe -Recurse |
        Where-Object { $_.FullName -like "*ggml.llamacpp*" } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $LlamaPath) {
    throw "llama.cpp가 없어 Hy-MT2 런타임을 묶을 수 없어. scripts/setup_hymt_runtime.ps1을 먼저 실행해줘."
}

$LlamaSource = Split-Path -Parent $LlamaPath
$LlamaDestination = Join-Path $ProjectRoot "dist\NudeTranslator\runtime\llama"
New-Item -ItemType Directory -Force $LlamaDestination | Out-Null
Copy-Item -LiteralPath (Join-Path $LlamaSource "llama-server.exe") -Destination $LlamaDestination
Get-ChildItem -LiteralPath $LlamaSource -Filter "*.dll" |
    Copy-Item -Destination $LlamaDestination

$ReleaseDirectory = Join-Path $ProjectRoot 'release'
New-Item -ItemType Directory -Force $ReleaseDirectory | Out-Null
$ReleaseArchive = Join-Path $ReleaseDirectory 'NudeTranslator-Windows-x64.zip'
Remove-Item -LiteralPath $ReleaseArchive -Force -ErrorAction SilentlyContinue
& tar.exe -a -c -f $ReleaseArchive -C "$ProjectRoot\dist\NudeTranslator" .
if ($LASTEXITCODE -ne 0) {
    throw "릴리스 ZIP 생성 실패 (exit code: $LASTEXITCODE)"
}

Write-Host "패키징 완료: $ProjectRoot\dist\NudeTranslator"
Write-Host "GitHub Release 파일: $ReleaseArchive"
Write-Host "Hy-MT2용 llama.cpp 런타임을 포함했어. 모델 가중치는 첫 사용 때 별도로 받아."
