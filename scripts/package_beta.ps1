param(
    [string]$UpdateEndpoint = $env:NUDE_TRANSLATOR_UPDATE_ENDPOINT,
    [string]$BetaToken = $env:NUDE_TRANSLATOR_BETA_TOKEN,
    [string]$ReleaseNotes = 'Discord 메시지의 줄바꿈과 서식을 보존하고 설정 화면의 안내 문구, 여백 및 번역 서비스 모델 표기를 정리한 0.4.7 비공개 베타',
    [switch]$IncludeDefaultModel,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$SecretDirectory = Join-Path $env:LOCALAPPDATA 'NudeTranslator\secrets'
$EndpointFile = Join-Path $SecretDirectory 'update-endpoint.txt'
$TokenFile = Join-Path $SecretDirectory 'beta-token.txt'
$PrivateKey = Join-Path $SecretDirectory 'updater.key'
$PrivateKeyPasswordFile = Join-Path $SecretDirectory 'updater-password.txt'
$StagingRuntime = Join-Path $ProjectRoot 'src-tauri\bundle-resources\runtime'
$DeveloperBuildTargets = @(
    (Join-Path $ProjectRoot 'dist\NudeNyangTranslator\NudeNyangTranslator.exe'),
    (Join-Path $ProjectRoot 'dist\NudeTranslator\NudeTranslator.exe')
)
$TauriConfig = Get-Content -Raw (Join-Path $ProjectRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$Version = [string]$TauriConfig.version

if (-not $UpdateEndpoint -and (Test-Path -LiteralPath $EndpointFile)) {
    $UpdateEndpoint = (Get-Content -Raw -LiteralPath $EndpointFile).Trim()
}
if (-not $BetaToken -and (Test-Path -LiteralPath $TokenFile)) {
    $BetaToken = (Get-Content -Raw -LiteralPath $TokenFile).Trim()
}
if (-not $UpdateEndpoint -or $UpdateEndpoint -notmatch '^https://') {
    throw 'HTTPS 업데이트 서버 주소가 없습니다. scripts/setup_beta_r2.ps1을 먼저 실행하십시오.'
}
if (-not $BetaToken -or $BetaToken.Length -lt 32) {
    throw '32자 이상의 베타 업데이트 토큰이 없습니다. scripts/setup_beta_r2.ps1을 먼저 실행하십시오.'
}
if (-not (Test-Path -LiteralPath $PrivateKey)) {
    throw "업데이트 서명 개인 키가 없습니다: $PrivateKey"
}
if (-not (Test-Path -LiteralPath $PrivateKeyPasswordFile)) {
    throw "업데이트 서명 키 비밀번호가 없습니다: $PrivateKeyPasswordFile"
}
$PrivateKeyPassword = (Get-Content -Raw -LiteralPath $PrivateKeyPasswordFile).Trim()
if (-not $PrivateKeyPassword) {
    throw '업데이트 서명 키 비밀번호가 비어 있습니다.'
}

function Resolve-LlamaSource {
    $command = Get-Command llama-server -ErrorAction SilentlyContinue
    if ($command) { return (Split-Path -Parent $command.Source) }
    $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $path = Get-ChildItem $wingetPackages -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*ggml.llamacpp*' } |
        Select-Object -First 1 -ExpandProperty FullName
    if ($path) { return (Split-Path -Parent $path) }
    throw 'llama.cpp가 없습니다. scripts/setup_hymt_runtime.ps1을 먼저 실행하십시오.'
}

function Assert-DeveloperBuildStopped {
    $targets = $DeveloperBuildTargets | ForEach-Object { [IO.Path]::GetFullPath($_) }
    $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ExecutablePath -and
            $targets.Contains([IO.Path]::GetFullPath([string]$_.ExecutablePath))
        } |
        Select-Object -First 1
    if ($running) {
        throw "개발자 실행본이 열려 있습니다. 앱을 완전히 종료한 뒤 다시 패키징하십시오: $($running.ExecutablePath)"
    }
}

function Sync-DeveloperBuild {
    param([Parameter(Mandatory)][string]$SourceExecutable)

    if (-not (Test-Path -LiteralPath $SourceExecutable)) {
        throw "동기화할 개발자 실행 파일이 없습니다: $SourceExecutable"
    }
    foreach ($target in $DeveloperBuildTargets) {
        $directory = Split-Path -Parent $target
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Copy-Item -LiteralPath $SourceExecutable -Destination $target -Force

        $runtimeSource = Join-Path $StagingRuntime 'llama'
        if (Test-Path -LiteralPath $runtimeSource) {
            $runtimeDestination = Join-Path $directory 'runtime\llama'
            New-Item -ItemType Directory -Path $runtimeDestination -Force | Out-Null
            Get-ChildItem -LiteralPath $runtimeSource -File |
                Copy-Item -Destination $runtimeDestination -Force
        }

        $developerVersion = (Get-Item -LiteralPath $target).VersionInfo.ProductVersion
        if ([string]$developerVersion -ne $Version) {
            throw "개발자 실행본 버전이 일치하지 않습니다: $target ($developerVersion)"
        }
        Write-Host "개발자 실행본 동기화 완료: $target ($developerVersion)"
    }
}

Assert-DeveloperBuildStopped

if (-not $SkipBuild) {
    $resolvedStaging = [System.IO.Path]::GetFullPath($StagingRuntime)
    if (-not $resolvedStaging.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "프로젝트 밖의 스테이징 경로는 정리할 수 없습니다: $resolvedStaging"
    }
    New-Item -ItemType Directory -Path $resolvedStaging -Force | Out-Null
    Get-ChildItem -LiteralPath $resolvedStaging -Force |
        Where-Object { $_.Name -ne '.gitkeep' } |
        Remove-Item -Recurse -Force
    $llamaDestination = Join-Path $resolvedStaging 'llama'
    New-Item -ItemType Directory -Path $llamaDestination -Force | Out-Null
    $llamaSource = Resolve-LlamaSource
    Copy-Item -LiteralPath (Join-Path $llamaSource 'llama-server.exe') -Destination $llamaDestination -Force
    Get-ChildItem -LiteralPath $llamaSource -Filter '*.dll' | Copy-Item -Destination $llamaDestination -Force

    if ($IncludeDefaultModel) {
        $modelSource = Join-Path $env:LOCALAPPDATA 'LocalTools\DiscordTranslateOverlay\Cache\models\hy-mt2\1.8b\Hy-MT2-1.8B-Q4_K_M.gguf'
        if (-not (Test-Path -LiteralPath $modelSource)) {
            throw "내장할 Hy-MT2 1.8B 모델이 없습니다: $modelSource"
        }
        $modelDestination = Join-Path $resolvedStaging 'models\hy-mt2\1.8b'
        New-Item -ItemType Directory -Path $modelDestination -Force | Out-Null
        Copy-Item -LiteralPath $modelSource -Destination $modelDestination -Force
    }

    $env:TAURI_SIGNING_PRIVATE_KEY = $PrivateKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $PrivateKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $PrivateKeyPassword
    $env:NUDE_TRANSLATOR_UPDATE_ENDPOINT = $UpdateEndpoint
    $env:NUDE_TRANSLATOR_BETA_TOKEN = $BetaToken
    Push-Location $ProjectRoot
    try {
        npm run tauri -- build --bundles nsis
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri NSIS 베타 빌드에 실패했습니다(exit code: $LASTEXITCODE)."
        }
    }
    finally {
        Pop-Location
    }
}

$BuiltExecutable = Join-Path $ProjectRoot 'src-tauri\target\release\nude-translator-tauri.exe'
Sync-DeveloperBuild -SourceExecutable $BuiltExecutable

$BundleDirectory = Join-Path $ProjectRoot 'src-tauri\target\release\bundle\nsis'
$Installer = Get-ChildItem -LiteralPath $BundleDirectory -Filter '*setup.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $Installer) {
    throw "NSIS 설치 파일을 찾지 못했습니다: $BundleDirectory"
}
$Signature = "$($Installer.FullName).sig"
if (-not (Test-Path -LiteralPath $Signature)) {
    throw "업데이트 서명 파일을 찾지 못했습니다: $Signature"
}

$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
$InstallerName = "NudeNyangTranslator-$Version-Windows-x64-Setup.exe"
$ReleaseInstaller = Join-Path $ReleaseDirectory $InstallerName
Copy-Item -LiteralPath $Installer.FullName -Destination $ReleaseInstaller -Force
Copy-Item -LiteralPath $Signature -Destination "$ReleaseInstaller.sig" -Force
$ObjectKey = "beta/releases/$Version/$InstallerName"
$Manifest = [ordered]@{
    version = $Version
    notes = $ReleaseNotes
    pub_date = [DateTime]::UtcNow.ToString('o')
    installer_object_key = $ObjectKey
    sha256 = (Get-FileHash -LiteralPath $ReleaseInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{
            object_key = $ObjectKey
            signature = (Get-Content -Raw -LiteralPath "$ReleaseInstaller.sig").Trim()
        }
    }
}
$ManifestPath = Join-Path $ReleaseDirectory 'latest.json'
$ManifestJson = $Manifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($ManifestPath, $ManifestJson, [Text.UTF8Encoding]::new($false))

$SizeMb = [math]::Round((Get-Item -LiteralPath $ReleaseInstaller).Length / 1MB, 1)
Write-Host "베타 설치 파일: $ReleaseInstaller"
Write-Host "업데이트 매니페스트: $ManifestPath"
Write-Host "설치 파일 크기: $SizeMb MB"
Write-Host "Hy-MT2 모델 포함: $($IncludeDefaultModel.IsPresent)"
