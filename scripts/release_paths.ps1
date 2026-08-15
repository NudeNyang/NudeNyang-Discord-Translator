function Resolve-NudeNyangReleaseSecretDirectory {
    $localAppData = [IO.Path]::GetFullPath([string]$env:LOCALAPPDATA)
    $current = [IO.Path]::GetFullPath((Join-Path $localAppData 'NudeNyang Discord Translator\secrets'))
    $legacy = [IO.Path]::GetFullPath((Join-Path $localAppData 'NudeTranslator\secrets'))
    foreach ($path in @($current, $legacy)) {
        if (-not $path.StartsWith($localAppData, [StringComparison]::OrdinalIgnoreCase)) {
            throw "릴리스 비밀 정보 경로가 LOCALAPPDATA 밖을 가리킵니다: $path"
        }
    }
    if ((Test-Path -LiteralPath $legacy) -and -not (Test-Path -LiteralPath $current)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $current) -Force | Out-Null
        Move-Item -LiteralPath $legacy -Destination $current
        $legacyParent = Split-Path -Parent $legacy
        if (-not (Get-ChildItem -LiteralPath $legacyParent -Force -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $legacyParent -Force
        }
    }
    New-Item -ItemType Directory -Path $current -Force | Out-Null
    return $current
}
