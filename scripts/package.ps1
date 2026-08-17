param(
    [switch]$Clean,
    [switch]$SkipBuild,
    [switch]$IncludeLargeModel
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verify_llama_runtime.ps1')
. (Join-Path $PSScriptRoot 'stage_msvc_runtime.ps1')
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$DistDirectory = Join-Path $ProjectRoot 'dist\NudeNyangDiscordTranslator'
$ReleaseDirectory = Join-Path $ProjectRoot 'release'

if ($Clean) {
    foreach ($target in @($DistDirectory, $ReleaseDirectory)) {
        $full = [System.IO.Path]::GetFullPath($target)
        if (-not $full.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "프로젝트 밖의 경로는 삭제할 수 없습니다: $full"
        }
        Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Set-Location $ProjectRoot
if (-not $SkipBuild) {
    npm run tauri:build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri 릴리스 빌드에 실패했습니다(exit code: $LASTEXITCODE)."
    }
}

$Executable = Join-Path $ProjectRoot 'src-tauri\target\release\nude-translator-tauri.exe'
if (-not (Test-Path -LiteralPath $Executable)) {
    throw "Rust 릴리스 실행 파일이 없습니다: $Executable"
}

New-Item -ItemType Directory -Force $DistDirectory | Out-Null
Copy-Item -LiteralPath $Executable -Destination (Join-Path $DistDirectory 'NudeNyangDiscordTranslator.exe') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination (Join-Path $DistDirectory 'LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'THIRD_PARTY_NOTICES.md') -Destination $DistDirectory -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'licenses') -Destination $DistDirectory -Recurse -Force

$WingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$LlamaPath = Get-ChildItem $WingetPackages -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\ggml.llamacpp_Microsoft.Winget.Source_*\llama-server.exe' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $LlamaPath) {
    throw '검증된 WinGet ggml.llamacpp 패키지가 없습니다. scripts/setup_hymt_runtime.ps1을 먼저 실행하십시오.'
}

$LlamaSource = Split-Path -Parent $LlamaPath
Assert-LlamaRuntimeVerified -SourceDirectory $LlamaSource
$LlamaDestination = Join-Path $DistDirectory 'runtime\llama'
New-Item -ItemType Directory -Force $LlamaDestination | Out-Null
Copy-Item -LiteralPath (Join-Path $LlamaSource 'llama-server.exe') -Destination $LlamaDestination -Force
Get-ChildItem -LiteralPath $LlamaSource -Filter '*.dll' | Copy-Item -Destination $LlamaDestination -Force
Copy-MsvcRuntime -DestinationDirectory $LlamaDestination

$ModelCache = Join-Path $env:LOCALAPPDATA 'LocalTools\NudeNyang Discord Translator\Cache\models\hy-mt2'
$Models = @(
    @{
        Key = '1.8b'
        File = 'Hy-MT2-1.8B-Q4_K_M.gguf'
        Required = $true
    },
    @{
        Key = '7b'
        File = 'Hy-MT2-7B-Q4_K_M.gguf'
        Required = $IncludeLargeModel.IsPresent
    }
)
foreach ($model in $Models) {
    if (-not $model.Required) { continue }
    $source = Join-Path (Join-Path $ModelCache $model.Key) $model.File
    if (-not (Test-Path -LiteralPath $source)) {
        throw "내장할 Hy-MT2 모델이 없습니다: $source`n앱에서 해당 모델을 한 번 준비한 후 다시 패키징하십시오."
    }
    $destination = Join-Path $DistDirectory "runtime\models\hy-mt2\$($model.Key)"
    New-Item -ItemType Directory -Force $destination | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

New-Item -ItemType Directory -Force $ReleaseDirectory | Out-Null
$Archive = Join-Path $ReleaseDirectory 'NudeNyang-Translator-x64.zip'
Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
& tar.exe -a -c -f $Archive -C $DistDirectory .
if ($LASTEXITCODE -ne 0) {
    throw "릴리스 ZIP 생성에 실패했습니다(exit code: $LASTEXITCODE)."
}

Write-Host "패키징 완료: $DistDirectory"
Write-Host "릴리스 파일: $Archive"
Write-Host 'Python 없이 Tauri/Rust 앱, llama.cpp, Hy-MT2 1.8B 모델을 포함했습니다.'
if ($IncludeLargeModel) {
    Write-Host 'Hy-MT2 7B 모델도 포함했습니다.'
}
