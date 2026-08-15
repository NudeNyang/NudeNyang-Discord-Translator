$script:NudeNyangVcRuntimeFiles = @(
    'concrt140.dll',
    'msvcp140.dll',
    'msvcp140_1.dll',
    'msvcp140_2.dll',
    'msvcp140_atomic_wait.dll',
    'msvcp140_codecvt_ids.dll',
    'vccorlib140.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'vcruntime140_threads.dll'
)

function Resolve-VcRuntimeDirectory {
    $roots = @(
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)}
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $candidates = foreach ($root in $roots) {
        Get-ChildItem -LiteralPath (Join-Path $root 'Microsoft Visual Studio') `
            -Filter 'msvcp140.dll' -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object {
                $_.FullName -match '\\VC\\Redist\\MSVC\\[^\\]+\\x64\\Microsoft\.VC\d+\.CRT\\msvcp140\.dll$'
            }
    }
    $selected = $candidates |
        Sort-Object @{ Expression = { [version]$_.VersionInfo.FileVersion }; Descending = $true }, FullName -Descending |
        Select-Object -First 1
    if (-not $selected) {
        throw '공식 Microsoft Visual C++ x64 재배포 런타임을 찾지 못했습니다. Visual Studio Build Tools의 C++ 재배포 구성요소를 설치하십시오.'
    }
    return $selected.DirectoryName
}

function Copy-VcRuntimeFiles {
    param([Parameter(Mandatory)][string]$DestinationDirectory)

    $sourceDirectory = Resolve-VcRuntimeDirectory
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    foreach ($name in $script:NudeNyangVcRuntimeFiles) {
        $source = Join-Path $sourceDirectory $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Microsoft Visual C++ 재배포 런타임 파일이 누락되었습니다: $source"
        }
        Copy-Item -LiteralPath $source -Destination (Join-Path $DestinationDirectory $name) -Force
    }
    Write-Host "Microsoft Visual C++ x64 앱 로컬 런타임 포함 완료: $DestinationDirectory"
}

