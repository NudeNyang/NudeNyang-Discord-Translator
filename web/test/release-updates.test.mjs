import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = (name) => readFileSync(new URL(`../../scripts/${name}`, import.meta.url), 'utf8');

test('공개 패키징은 x64·ARM64 빌드와 검증을 함께 수행하고 게시 전 업데이트 주소를 바꾸지 않는다', () => {
  const source = script('package_github_release.ps1');
  assert.match(source, /package_windows_variants\.ps1/);
  assert.match(source, /release-updates\.mjs/);
  assert.doesNotMatch(source, /WriteAllText\(\$TrackedManifestPath/);
  assert.match(script('deploy_github_release.ps1'), /--prerelease/);
  assert.match(script('deploy_github_release.ps1'), /--latest=false/);
});

async function fixture(t) {
  const helper = await import('../../scripts/release-updates.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'nudenyang-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = randomBytes(8);
  const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubkey = Buffer.from(`untrusted comment: test key\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPublic]).toString('base64')}\n`).toString('base64');
  const options = { directory, version: '0.7.3-beta', repository: 'NudeNyang/NudeNyang-Discord-Translator', pubkey, commit: 'a'.repeat(40) };
  const names = helper.installerNames(options.version);
  for (const [platform, name] of Object.entries(names)) {
    const data = Buffer.from(`synthetic installer for ${platform}`);
    const signature = sign(null, createHash('blake2b512').update(data).digest(), privateKey);
    const comment = `timestamp:1\tfile:${name}`;
    const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
    const text = `untrusted comment: synthetic\n${Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64')}\ntrusted comment: ${comment}\n${globalSignature.toString('base64')}\n`;
    writeFileSync(join(directory, name), data);
    writeFileSync(join(directory, `${name}.sig`), Buffer.from(text).toString('base64'));
  }
  helper.generateRelease({ ...options, notes: 'Synthetic release notes' });
  return { helper, options, names, directory };
}

test('두 아키텍처의 서명·체크섬·플랫폼 URL을 생성하고 모두 검증한다', async (t) => {
  const f = await fixture(t);
  const result = f.helper.validateRelease(f.options);
  assert.equal(result.artifacts.length, 6);
  assert.deepEqual(Object.keys(result.manifest.platforms), ['windows-x86_64', 'windows-aarch64']);
  assert.equal(result.manifest.version, '0.7.3-beta');
});

for (const damage of ['missing-arm', 'missing-arm-signature', 'empty-signature', 'changed-installer', 'wrong-key', 'missing-platform', 'wrong-url', 'wrong-signature', 'wrong-version', 'wrong-commit', 'missing-checksum']) {
  test(`릴리스 검증은 ${damage} 상태를 차단한다`, async (t) => {
    const f = await fixture(t);
    const arm = f.names['windows-aarch64'];
    const manifestPath = join(f.directory, 'latest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (damage === 'missing-arm') unlinkSync(join(f.directory, arm));
    if (damage === 'missing-arm-signature') unlinkSync(join(f.directory, `${arm}.sig`));
    if (damage === 'empty-signature') writeFileSync(join(f.directory, `${arm}.sig`), '');
    if (damage === 'changed-installer') writeFileSync(join(f.directory, arm), 'tampered');
    if (damage === 'wrong-key') f.options.pubkey = Buffer.from('invalid public key').toString('base64');
    if (damage === 'missing-platform') delete manifest.platforms['windows-aarch64'];
    if (damage === 'wrong-url') manifest.platforms['windows-aarch64'].url = manifest.platforms['windows-x86_64'].url;
    if (damage === 'wrong-signature') manifest.platforms['windows-aarch64'].signature = manifest.platforms['windows-x86_64'].signature;
    if (damage === 'wrong-version') manifest.version = '0.7.2-beta';
    if (damage === 'wrong-commit') manifest.source_commit = 'b'.repeat(40);
    if (damage === 'missing-checksum') unlinkSync(join(f.directory, 'SHA256SUMS.txt'));
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => f.helper.validateRelease(f.options));
  });
}

test('서명 파일 안의 신뢰 주석도 변조하면 검증에 실패한다', async (t) => {
  const f = await fixture(t);
  const name = f.names['windows-aarch64'];
  const path = join(f.directory, `${name}.sig`);
  const original = readFileSync(path, 'utf8');
  const changed = Buffer.from(Buffer.from(original, 'base64').toString('utf8').replace('timestamp:1', 'timestamp:2')).toString('base64');
  assert.throws(() => f.helper.verifyUpdaterSignature(readFileSync(join(f.directory, name)), changed, f.options.pubkey));
});

for (const scenario of ['success', 'missing-arm', 'upload-digest-mismatch', 'publish-failed', 'draft-source-mismatch', 'draft-already-public', 'draft-missing']) {
  test(`실제 PowerShell 배포 흐름: ${scenario}`, { skip: process.platform !== 'win32' }, async (t) => {
    const f = await fixture(t);
    const root = join(f.directory, 'project');
    for (const folder of ['scripts', 'src-tauri', 'updates/beta', `release/${f.options.version}`, 'docs/releases']) {
      mkdirSync(join(root, folder), { recursive: true });
    }
    for (const name of ['deploy_github_release.ps1', 'release-updates.mjs']) {
      // BOM keeps Korean diagnostics intact in Windows PowerShell 5.1.
      writeFileSync(join(root, 'scripts', name), (name.endsWith('.ps1') ? '\uFEFF' : '') + script(name));
    }
    writeFileSync(join(root, '.gitignore'), '/release/\n');
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: f.options.version, plugins: { updater: { pubkey: f.options.pubkey } } }));
    writeFileSync(join(root, `docs/releases/${f.options.version}.md`), '한글 릴리스 안내');
    const trackedManifest = join(root, 'updates/beta/latest.json');
    writeFileSync(trackedManifest, 'old public manifest');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic fixture');
    const commit = git('rev-parse', 'HEAD');
    const directory = join(root, 'release', f.options.version);
    for (const name of Object.values(f.names).flatMap(name => [name, `${name}.sig`])) copyFileSync(join(f.directory, name), join(directory, name));
    const result = f.helper.generateRelease({ ...f.options, directory, commit, notes: '한글 릴리스 안내' });
    const remote = { id: 12345, tag_name: `v${f.options.version}`, target_commitish: commit, draft: true, prerelease: true, assets: result.artifacts.map(a => ({ ...a, state: 'uploaded', digest: `sha256:${a.sha256}` })) };
    if (scenario === 'draft-source-mismatch') remote.target_commitish = 'b'.repeat(40);
    if (scenario === 'draft-already-public') remote.draft = false;
    if (scenario === 'missing-arm') unlinkSync(join(directory, f.names['windows-aarch64']));
    if (scenario === 'upload-digest-mismatch') remote.assets[0].digest = `sha256:${'0'.repeat(64)}`;
    const remotePath = join(f.directory, 'remote.json');
    const logPath = join(f.directory, 'gh-calls.jsonl');
    writeFileSync(remotePath, JSON.stringify(remote));
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const harness = `
$ErrorActionPreference = 'Stop'
$script:published = $false
function gh {
  [IO.File]::AppendAllText(${quote(logPath)}, (ConvertTo-Json -InputObject @($args) -Compress) + [Environment]::NewLine)
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'api' -and $args[1] -like '*/commits/main') { return '${commit}' }
  if ($args[0] -eq 'release' -and $args[1] -eq 'list') { return '[]' }
  if ($args[0] -eq 'release' -and $args[1] -eq 'create') { return }
  if ($args[0] -eq 'release' -and $args[1] -eq 'edit') {
    ${scenario === 'publish-failed' ? '$global:LASTEXITCODE = 1' : '$script:published = $true'}
    return
  }
  if ($args[0] -eq 'api' -and $args[1] -like '*/releases?per_page=100') {
    ${scenario === 'draft-missing' ? "return '[]'" : `return '[' + [IO.File]::ReadAllText(${quote(remotePath)}) + ']'`}
  }
  if ($args[0] -eq 'api' -and $args[1] -like '*/releases/tags/*' -and -not $script:published) {
    $global:LASTEXITCODE = 1
    return 'Not Found: draft tag does not exist yet'
  }
  if ($args[0] -eq 'api' -and ($args[1] -like '*/releases/12345' -or ($args[1] -like '*/releases/tags/*' -and $script:published))) {
    $remote = [IO.File]::ReadAllText(${quote(remotePath)}) | ConvertFrom-Json
    $remote.draft = -not $script:published
    return ($remote | ConvertTo-Json -Depth 8)
  }
  throw 'Unexpected gh invocation'
}
& ${quote(join(root, 'scripts/deploy_github_release.ps1'))}
`;
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30_000 });
    const calls = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse) : [];
    const create = calls.find(args => args[0] === 'release' && args[1] === 'create');
    const publish = calls.find(args => args[0] === 'release' && args[1] === 'edit');
    if (scenario === 'success') {
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
      for (const flag of ['--draft', '--prerelease', '--latest=false']) assert.ok(create.includes(flag));
      assert.equal(create.filter(arg => arg.startsWith(directory)).length, 6);
      assert.ok(publish.includes('--draft=false') && publish.includes('--prerelease') && publish.includes('--latest=false'));
      assert.equal(readFileSync(trackedManifest, 'utf8'), readFileSync(join(directory, 'latest.json'), 'utf8'));
    } else {
      assert.notEqual(run.status, 0, 'deployment must fail');
      assert.equal(readFileSync(trackedManifest, 'utf8'), 'old public manifest');
      if (scenario === 'missing-arm') {
        assert.equal(calls.length, 0, 'No GitHub call before local validation passes');
        assert.match(run.stderr, /Release validation failed/);
      }
      if (scenario === 'upload-digest-mismatch') { assert.ok(create); assert.equal(publish, undefined); }
      if (scenario.startsWith('draft-')) { assert.ok(create); assert.equal(publish, undefined); }
      if (scenario === 'publish-failed') assert.ok(publish);
    }
  });
}
