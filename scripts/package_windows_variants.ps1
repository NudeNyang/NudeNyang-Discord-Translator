param(
    [ValidateSet('x64', 'arm64')]
    [string[]]$Architectures = @('x64', 'arm64'),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verify_llama_runtime.ps1')
. (Join-Path $PSScriptRoot 'stage_msvc_runtime.ps1')

$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$TauriDirectory = Join-Path $ProjectRoot 'src-tauri'
$StagingRuntime = Join-Path $TauriDirectory 'bundle-resources\runtime'
$TauriConfigPath = Join-Path $TauriDirectory 'tauri.conf.json'
$TauriConfig = Get-Content -Raw -LiteralPath $TauriConfigPath | ConvertFrom-Json
$Version = [string]$TauriConfig.version
$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
$DistRoot = Join-Path $ProjectRoot 'dist'
$DeveloperDirectory = Join-Path $DistRoot 'NudeNyangDiscordTranslator'
$DeveloperExecutable = Join-Path $DeveloperDirectory 'NudeNyangDiscordTranslator.exe'
$VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$PublicUpdateEndpoint = 'https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json'
$ArmLlamaVersion = 'b10236'
$ArmLlamaArchiveName = 'llama-b10236-bin-win-cpu-arm64.zip'
$ArmLlamaArchiveSha256 = '03dc9076cef9bf60520812666c8a327c8a2137bac797ce4d19f83748f125d8e0'
$ArmLlamaUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$ArmLlamaVersion/$ArmLlamaArchiveName"

$ArchitectureMap = @{
    x64 = @{
        RustTarget = 'x86_64-pc-windows-msvc'
        VcVarsArchitecture = 'x64'
        PeMachine = 0x8664
    }
    arm64 = @{
        RustTarget = 'aarch64-pc-windows-msvc'
        VcVarsArchitecture = 'x64_arm64'
        PeMachine = 0xAA64
    }
}

function Assert-PathInsideProject {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($ProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "프로젝트 밖의 경로는 정리할 수 없습니다: $resolved"
    }
    return $resolved
}

function Clear-DirectoryContents {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = Assert-PathInsideProject -Path $Path
    New-Item -ItemType Directory -Path $resolved -Force | Out-Null
    Get-ChildItem -LiteralPath $resolved -Force |
        Where-Object { $_.Name -ne '.gitkeep' } |
        Remove-Item -Recurse -Force
}

function Get-PeMachine {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) {
            throw "PE 실행 파일이 아닙니다: $Path"
        }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadUInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) {
            throw "PE 헤더를 찾지 못했습니다: $Path"
        }
        return $reader.ReadUInt16()
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-PeArchitecture {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$ExpectedMachine,
        [Parameter(Mandatory)][string]$Architecture
    )

    $actual = Get-PeMachine -Path $Path
    if ($actual -ne $ExpectedMachine) {
        throw "실행 파일 아키텍처가 $Architecture 이(가) 아닙니다: $Path (0x$($actual.ToString('X4')))"
    }
}

function Resolve-ClangDirectory {
    $candidates = [Collections.Generic.List[string]]::new()
    $candidates.Add('C:\Program Files\LLVM\bin')
    $clangCommand = Get-Command clang.exe -ErrorAction SilentlyContinue
    if ($clangCommand) {
        $candidates.Add((Split-Path -Parent $clangCommand.Source))
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'clang.exe') -PathType Leaf) {
            return $candidate
        }
    }

    throw 'Windows ARM64 빌드에 필요한 LLVM clang을 찾지 못했습니다. LLVM.LLVM 패키지를 설치하십시오.'
}

function Resolve-X64LlamaSource {
    $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $server = Get-ChildItem -LiteralPath $wingetPackages -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\ggml.llamacpp_Microsoft.Winget.Source_*\llama-server.exe' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $server) {
        throw '검증된 WinGet ggml.llamacpp 패키지가 없습니다. scripts/setup_hymt_runtime.ps1을 먼저 실행하십시오.'
    }
    $source = Split-Path -Parent $server
    Assert-LlamaRuntimeVerified -SourceDirectory $source
    return $source
}

function Resolve-Arm64LlamaSource {
    $cacheRoot = Join-Path $env:LOCALAPPDATA "NudeNyangBuildCache\llama.cpp\$ArmLlamaVersion\arm64"
    $archive = Join-Path $cacheRoot $ArmLlamaArchiveName
    $expanded = Join-Path $cacheRoot 'expanded'
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

    $downloadRequired = -not (Test-Path -LiteralPath $archive -PathType Leaf)
    if (-not $downloadRequired) {
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        $downloadRequired = $actual -ne $ArmLlamaArchiveSha256
    }
    if ($downloadRequired) {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $ArmLlamaUrl -OutFile $archive
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ArmLlamaArchiveSha256) {
        throw "ARM64 llama.cpp 공식 아카이브 무결성 검증에 실패했습니다: $archive"
    }

    Remove-Item -LiteralPath $expanded -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    $server = Get-ChildItem -LiteralPath $expanded -Filter llama-server.exe -File -Recurse |
        Select-Object -First 1
    if (-not $server) {
        throw "ARM64 llama-server.exe를 찾지 못했습니다: $expanded"
    }
    return $server.DirectoryName
}

function Stage-NativeRuntime {
    param([Parameter(Mandatory)][string]$Architecture)

    Clear-DirectoryContents -Path $StagingRuntime
    $llamaDestination = Join-Path $StagingRuntime 'llama'
    New-Item -ItemType Directory -Path $llamaDestination -Force | Out-Null
    $source = if ($Architecture -eq 'x64') {
        Resolve-X64LlamaSource
    }
    else {
        Resolve-Arm64LlamaSource
    }
    Copy-Item -LiteralPath (Join-Path $source 'llama-server.exe') -Destination $llamaDestination -Force
    Get-ChildItem -LiteralPath $source -Filter '*.dll' -File |
        Copy-Item -Destination $llamaDestination -Force
    Copy-MsvcRuntime -DestinationDirectory $llamaDestination -Architecture $Architecture

    $expected = [int]$ArchitectureMap[$Architecture].PeMachine
    Assert-PeArchitecture -Path (Join-Path $llamaDestination 'llama-server.exe') -ExpectedMachine $expected -Architecture $Architecture
}

function New-PortablePackage {
    param(
        [Parameter(Mandatory)][string]$Architecture,
        [Parameter(Mandatory)][string]$BuiltExecutable
    )

    $portableDirectory = Join-Path $DistRoot "NudeNyangDiscordTranslator-Windows-$Architecture-Portable"
    Clear-DirectoryContents -Path $portableDirectory
    Copy-Item -LiteralPath $BuiltExecutable -Destination (Join-Path $portableDirectory 'NudeNyangDiscordTranslator.exe') -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination (Join-Path $portableDirectory 'LICENSE.txt') -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'THIRD_PARTY_NOTICES.md') -Destination $portableDirectory -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'licenses') -Destination $portableDirectory -Recurse -Force
    $portableRuntime = Join-Path $portableDirectory 'runtime'
    New-Item -ItemType Directory -Path $portableRuntime -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $StagingRuntime 'llama') -Destination (Join-Path $portableRuntime 'llama') -Recurse -Force

    $notice = @"
NudeNyang Discord Translator $Version ($Architecture portable)

설치 없이 NudeNyangDiscordTranslator.exe를 실행할 수 있습니다.
설정, 번역 기록, 내려받은 로컬 모델은 설치형과 동일하게 Windows 사용자 데이터 폴더에 저장됩니다.
로컬 번역 모델은 처음 사용할 때 내려받습니다.
"@
    [IO.File]::WriteAllText((Join-Path $portableDirectory 'PORTABLE.txt'), $notice, [Text.UTF8Encoding]::new($false))

    New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
    $archive = Join-Path $ReleaseDirectory "NudeNyangDiscordTranslator-$Version-Windows-$Architecture-Portable.zip"
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    & tar.exe -a -c -f $archive -C $portableDirectory .
    if ($LASTEXITCODE -ne 0) {
        throw "포터블 ZIP 생성에 실패했습니다(exit code: $LASTEXITCODE)."
    }
    return $archive
}

function Copy-InstallerPackage {
    param(
        [Parameter(Mandatory)][string]$Architecture,
        [Parameter(Mandatory)][string]$RustTarget
    )

    $bundleDirectory = Join-Path $TauriDirectory "target\$RustTarget\release\bundle\nsis"
    $installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter '*setup.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) {
        throw "NSIS 설치 파일을 찾지 못했습니다: $bundleDirectory"
    }
    New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
    $target = Join-Path $ReleaseDirectory "NudeNyangDiscordTranslator-$Version-Windows-$Architecture-Setup.exe"
    Copy-Item -LiteralPath $installer.FullName -Destination $target -Force
    return $target
}

if ([string]$TauriConfig.bundle.publisher -ne 'NudeNyang') {
    throw 'tauri.conf.json의 bundle.publisher가 NudeNyang으로 고정되어 있지 않습니다.'
}
if (-not (Test-Path -LiteralPath $VsWhere -PathType Leaf)) {
    throw 'Visual Studio Build Tools를 찾지 못했습니다. Windows x64/ARM64 C++ 빌드 도구를 설치하십시오.'
}
$requiredVisualStudioComponents = @('Microsoft.VisualStudio.Component.VC.Tools.x86.x64')
if ($Architectures -contains 'arm64') {
    $requiredVisualStudioComponents += 'Microsoft.VisualStudio.Component.VC.Tools.ARM64'
}
$VisualStudioPath = & $VsWhere -latest -products * -requires $requiredVisualStudioComponents -property installationPath
if (-not $VisualStudioPath) {
    throw '요청한 Windows x64/ARM64 C++ 빌드 도구가 모두 포함된 Visual Studio 설치를 찾지 못했습니다.'
}
$VcVarsAll = Join-Path $VisualStudioPath 'VC\Auxiliary\Build\vcvarsall.bat'
if (-not (Test-Path -LiteralPath $VcVarsAll -PathType Leaf)) {
    throw "Visual Studio C++ 개발 환경 스크립트를 찾지 못했습니다: $VcVarsAll"
}
if ($Architectures -contains 'arm64') {
    $clangDirectory = Resolve-ClangDirectory
    if (($env:PATH -split ';') -notcontains $clangDirectory) {
        $env:PATH = "$clangDirectory;$env:PATH"
    }
}

$buildOverride = Join-Path ([IO.Path]::GetTempPath()) "nudenyang-local-package-$PID.json"
[IO.File]::WriteAllText(
    $buildOverride,
    '{"bundle":{"createUpdaterArtifacts":false}}',
    [Text.UTF8Encoding]::new($false)
)

$artifacts = [Collections.Generic.List[string]]::new()
try {
    foreach ($architecture in $Architectures) {
        $metadata = $ArchitectureMap[$architecture]
        $rustTarget = [string]$metadata.RustTarget
        Stage-NativeRuntime -Architecture $architecture
        $env:NUDE_TRANSLATOR_UPDATE_ENDPOINT = $PublicUpdateEndpoint
        Remove-Item Env:NUDE_TRANSLATOR_BETA_TOKEN -ErrorAction SilentlyContinue

        if (-not $SkipBuild) {
            Push-Location $ProjectRoot
            try {
                $vcVarsArchitecture = [string]$metadata.VcVarsArchitecture
                $buildCommand = "call `"$VcVarsAll`" $vcVarsArchitecture && npm run tauri -- build --target $rustTarget --bundles nsis --config `"$buildOverride`""
                & $env:COMSPEC /d /s /c $buildCommand
                if ($LASTEXITCODE -ne 0) {
                    throw "Tauri $architecture 빌드에 실패했습니다(exit code: $LASTEXITCODE)."
                }
            }
            finally {
                Pop-Location
            }
        }

        $builtExecutable = Join-Path $TauriDirectory "target\$rustTarget\release\nude-translator-tauri.exe"
        if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
            throw "빌드 실행 파일을 찾지 못했습니다: $builtExecutable"
        }
        Assert-PeArchitecture -Path $builtExecutable -ExpectedMachine ([int]$metadata.PeMachine) -Architecture $architecture
        $artifacts.Add((Copy-InstallerPackage -Architecture $architecture -RustTarget $rustTarget))
        $artifacts.Add((New-PortablePackage -Architecture $architecture -BuiltExecutable $builtExecutable))

        if ($architecture -eq 'x64') {
            New-Item -ItemType Directory -Path $DeveloperDirectory -Force | Out-Null
            Copy-Item -LiteralPath $builtExecutable -Destination $DeveloperExecutable -Force
            $developerRuntime = Join-Path $DeveloperDirectory 'runtime\llama'
            New-Item -ItemType Directory -Path $developerRuntime -Force | Out-Null
            Get-ChildItem -LiteralPath $developerRuntime -Force -ErrorAction SilentlyContinue |
                Remove-Item -Recurse -Force
            Get-ChildItem -LiteralPath (Join-Path $StagingRuntime 'llama') -File |
                Copy-Item -Destination $developerRuntime -Force
        }
    }
}
finally {
    Remove-Item -LiteralPath $buildOverride -Force -ErrorAction SilentlyContinue
    if ($Architectures -contains 'x64') {
        Stage-NativeRuntime -Architecture 'x64'
    }
}

Write-Host 'Windows 패키지 생성 완료:'
foreach ($artifact in $artifacts) {
    $file = Get-Item -LiteralPath $artifact
    Write-Host "- $($file.FullName) ($([math]::Round($file.Length / 1MB, 1)) MB)"
}
