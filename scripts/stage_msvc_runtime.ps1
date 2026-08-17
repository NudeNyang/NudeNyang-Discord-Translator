$MsvcRuntimeFiles = @(
    'concrt140.dll'
    'msvcp140.dll'
    'msvcp140_1.dll'
    'msvcp140_2.dll'
    'msvcp140_atomic_wait.dll'
    'msvcp140_codecvt_ids.dll'
    'vccorlib140.dll'
    'vcruntime140.dll'
    'vcruntime140_1.dll'
    'vcruntime140_threads.dll'
)

function Test-MsvcRuntimeDirectory {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }
    foreach ($file in $MsvcRuntimeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $file) -PathType Leaf)) {
            return $false
        }
    }
    return $true
}

function Resolve-MsvcRuntimeSource {
    param(
        [ValidateSet('x64', 'arm64')]
        [string]$Architecture = 'x64'
    )

    $candidates = [Collections.Generic.List[string]]::new()
    if ($env:VCToolsRedistDir) {
        $candidates.Add((Join-Path $env:VCToolsRedistDir "$Architecture\Microsoft.VC143.CRT"))
        $candidates.Add((Join-Path $env:VCToolsRedistDir "$Architecture\Microsoft.VC145.CRT"))
    }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
        $installations = & $vswhere -products * -property installationPath
        foreach ($installation in $installations) {
            $redistRoot = Join-Path $installation 'VC\Redist\MSVC'
            if (-not (Test-Path -LiteralPath $redistRoot -PathType Container)) {
                continue
            }
            Get-ChildItem -LiteralPath $redistRoot -Directory |
                Sort-Object Name -Descending |
                ForEach-Object {
                    Get-ChildItem -LiteralPath (Join-Path $_.FullName $Architecture) -Directory -Filter 'Microsoft.VC*.CRT' -ErrorAction SilentlyContinue |
                        ForEach-Object { $candidates.Add($_.FullName) }
                }
        }
    }

    if ($Architecture -eq 'x64') {
        $candidates.Add((Join-Path $env:WINDIR 'System32'))
    }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-MsvcRuntimeDirectory -Path $candidate) {
            return $candidate
        }
    }

    throw "패키징에 필요한 Microsoft Visual C++ $Architecture 런타임을 찾지 못했습니다. Visual Studio Build Tools의 C++ $Architecture 구성요소를 설치하십시오."
}

function Assert-MsvcRuntimeSigned {
    param([Parameter(Mandatory)][string]$Directory)

    foreach ($file in $MsvcRuntimeFiles) {
        $path = Join-Path $Directory $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Microsoft Visual C++ 런타임 파일이 누락되었습니다: $path"
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $path
        $subject = [string]$signature.SignerCertificate.Subject
        if ($signature.Status -ne 'Valid' -or $subject -notmatch 'O=Microsoft Corporation') {
            throw "Microsoft 서명을 확인할 수 없는 Visual C++ 런타임 파일입니다: $path ($($signature.Status))"
        }
    }
}

function Copy-MsvcRuntime {
    param(
        [Parameter(Mandatory)][string]$DestinationDirectory,
        [ValidateSet('x64', 'arm64')]
        [string]$Architecture = 'x64'
    )

    $source = Resolve-MsvcRuntimeSource -Architecture $Architecture
    Assert-MsvcRuntimeSigned -Directory $source
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    foreach ($file in $MsvcRuntimeFiles) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination $DestinationDirectory -Force
    }
    Assert-MsvcRuntimeSigned -Directory $DestinationDirectory
    $version = (Get-Item -LiteralPath (Join-Path $DestinationDirectory 'msvcp140.dll')).VersionInfo.FileVersion
    Write-Host "Microsoft Visual C++ $Architecture 앱 로컬 런타임 포함 완료: $version"
}
