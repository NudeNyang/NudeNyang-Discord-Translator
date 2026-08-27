param(
    [string]$Version,
    [string]$Repository = 'NudeNyang/NudeNyang-Discord-Translator',
    [string]$ReleaseNotesPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$TauriConfigPath = Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'
$Config = [IO.File]::ReadAllText($TauriConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not $Version) { $Version = [string]$Config.version }
if ($Version -ne $Config.version) { throw '현재 소스 버전과 배포 버전이 다릅니다.' }
if ($Repository -ne 'NudeNyang/NudeNyang-Discord-Translator') { throw '기존 공개 업데이트 저장소를 유지해야 합니다.' }
if (-not $ReleaseNotesPath) { $ReleaseNotesPath = Join-Path $ProjectRoot "docs\releases\$Version.md" }
$ReleaseDirectory = Join-Path $ProjectRoot "release\$Version"
$ManifestPath = Join-Path $ReleaseDirectory 'latest.json'

Push-Location $ProjectRoot
try {
    if (git status --porcelain) { throw 'GitHub 릴리스 전에 작업 트리를 커밋하십시오.' }
    $SourceCommit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw '소스 커밋을 확인하지 못했습니다.' }
    $ValidationJson = node (Join-Path $PSScriptRoot 'release-updates.mjs') validate --project-root $ProjectRoot --commit $SourceCommit
    if ($LASTEXITCODE -ne 0) { throw '필수 설치형·서명·업데이트 목록 검증에 실패했습니다. 업로드하지 않습니다.' }
    $Validation = $ValidationJson | ConvertFrom-Json
    $Manifest = [IO.File]::ReadAllText($ManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if (([IO.File]::ReadAllText($ReleaseNotesPath, [Text.Encoding]::UTF8)).Trim() -ne $Manifest.notes) { throw '패키징 때 사용한 릴리스 노트와 다릅니다.' }
    $RemoteCommit = gh api "repos/$Repository/commits/main" --jq '.sha'
    if ($LASTEXITCODE -ne 0 -or $RemoteCommit.Trim() -ne $SourceCommit) { throw '현재 소스 커밋을 먼저 원격 main에 푸시하십시오.' }
    $ExistingJson = gh release list --repo $Repository --limit 1000 --json tagName
    if ($LASTEXITCODE -ne 0) { throw '기존 릴리스 목록을 확인하지 못했습니다.' }
    if (@($ExistingJson | ConvertFrom-Json | Where-Object { $_.tagName -eq "v$Version" }).Count -gt 0) {
        throw '동일 버전의 릴리스가 이미 있습니다. 기존 릴리스나 첨부 파일을 덮어쓰지 않습니다.'
    }

    $Artifacts = @($Validation.artifacts | ForEach-Object { Join-Path $ReleaseDirectory $_.name })
    $ReleaseFlags = @('--draft', '--latest=false')
    if ($Version.Contains('-')) { $ReleaseFlags += '--prerelease' }
    gh release create "v$Version" @Artifacts --repo $Repository --title ($Version -replace '-beta$', ' Beta') --notes-file $ReleaseNotesPath --target $SourceCommit @ReleaseFlags
    if ($LASTEXITCODE -ne 0) { throw '릴리스 초안 업로드에 실패했습니다. 생성된 초안은 확인 전 공개하지 마십시오.' }

    # An unpublished draft may not have a Git tag yet, so /releases/tags can
    # return 404 even to its author. Find this new draft in the authenticated
    # release list and verify it by numeric release ID instead.
    $DraftListJson = gh api "repos/$Repository/releases?per_page=100"
    if ($LASTEXITCODE -ne 0) { throw '업로드된 초안 목록을 확인하지 못했습니다.' }
    $Drafts = @($DraftListJson | ConvertFrom-Json | Where-Object { $_.tag_name -eq "v$Version" })
    if ($Drafts.Count -ne 1 -or -not $Drafts[0].draft -or $Drafts[0].target_commitish -ne $SourceCommit -or ($Version.Contains('-') -and -not $Drafts[0].prerelease)) {
        throw '생성된 초안의 버전·소스 커밋·공개 상태가 예상과 다릅니다.'
    }
    $ReleaseId = [long]$Drafts[0].id
    if ($ReleaseId -le 0) { throw '릴리스 초안 ID가 올바르지 않습니다.' }
    $RemoteJson = gh api "repos/$Repository/releases/$ReleaseId"
    if ($LASTEXITCODE -ne 0) { throw '업로드된 릴리스를 확인하지 못했습니다. 초안을 유지합니다.' }
    $Remote = $RemoteJson | ConvertFrom-Json
    if (-not $Remote.draft -or $Remote.tag_name -ne "v$Version" -or $Remote.target_commitish -ne $SourceCommit) { throw '검증 중 릴리스 초안이 변경되었습니다.' }
    foreach ($artifact in $Validation.artifacts) {
        $UploadedAssets = @($Remote.assets | Where-Object { $_.name -eq $artifact.name })
        if ($UploadedAssets.Count -ne 1 -or $UploadedAssets[0].state -ne 'uploaded' -or $UploadedAssets[0].size -ne $artifact.size -or $UploadedAssets[0].digest -ne "sha256:$($artifact.sha256)") {
            throw "업로드 파일의 크기·SHA-256이 일치하지 않습니다. 초안을 유지합니다: $($artifact.name)"
        }
    }
    $PublishFlags = @('--draft=false', '--latest=false')
    if ($Version.Contains('-')) { $PublishFlags += '--prerelease' }
    gh release edit "v$Version" --repo $Repository @PublishFlags
    if ($LASTEXITCODE -ne 0) { throw '검증된 릴리스 공개에 실패했습니다.' }
    $PublishedJson = gh api "repos/$Repository/releases/$ReleaseId"
    if ($LASTEXITCODE -ne 0) { throw '공개 여부를 확인하지 못해 업데이트 목록을 변경하지 않습니다.' }
    $Published = $PublishedJson | ConvertFrom-Json
    if ($Published.draft -or $Published.tag_name -ne "v$Version" -or $Published.target_commitish -ne $SourceCommit -or ($Version.Contains('-') -and -not $Published.prerelease)) { throw '프리릴리스 공개 상태가 예상과 다릅니다.' }

    # Only advertise downloads after both verified installers are public.
    Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $ProjectRoot 'updates\beta\latest.json') -Force
}
finally { Pop-Location }

Write-Host "릴리스 공개 완료: v$Version. 생성된 updates/beta/latest.json을 검토·커밋·푸시하면 기존 주소의 자동 업데이트가 연결됩니다."
