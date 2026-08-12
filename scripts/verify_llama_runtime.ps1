function Assert-LlamaRuntimeVerified {
    param([Parameter(Mandatory)][string]$SourceDirectory)

    $manifestPath = Join-Path $PSScriptRoot 'llama-runtime-hashes.json'
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $expected = @{}
    foreach ($entry in $manifest.files.PSObject.Properties) {
        $expected[$entry.Name.ToLowerInvariant()] = ([string]$entry.Value).ToLowerInvariant()
    }
    $runtimeFiles = @(Get-ChildItem -LiteralPath $SourceDirectory -File | Where-Object {
        $_.Name -eq 'llama-server.exe' -or $_.Extension -eq '.dll'
    })
    foreach ($file in $runtimeFiles) {
        $name = $file.Name.ToLowerInvariant()
        if (-not $expected.ContainsKey($name)) {
            throw "해시 목록에 없는 llama.cpp 런타임 파일이 있습니다: $($file.Name)"
        }
        $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected[$name]) {
            throw "llama.cpp 런타임 무결성 검증에 실패했습니다: $($file.Name)"
        }
        $expected.Remove($name)
    }
    if ($expected.Count -gt 0) {
        throw "llama.cpp 런타임 파일이 누락되었습니다: $([string]::Join(', ', $expected.Keys))"
    }
    Write-Host "llama.cpp $($manifest.version) 런타임 무결성 검증 완료"
}
