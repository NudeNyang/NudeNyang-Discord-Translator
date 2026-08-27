import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const UPDATE_ENDPOINT = 'https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json';
const PLATFORMS = ['windows-x86_64', 'windows-aarch64'];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function installerNames(version) {
  requireValue(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version), 'Invalid release version');
  return Object.fromEntries(PLATFORMS.map((platform, index) => [platform,
    `NudeNyang-Translator-${version}-${index ? 'ARM64' : 'x64'}-Setup.exe`]));
}

function decodeBase64(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value), 'Invalid base64 signature/key');
  const bytes = Buffer.from(value, 'base64');
  requireValue(bytes.toString('base64') === value, 'Non-canonical base64 signature/key');
  return bytes;
}

// Tauri wraps the Minisign text in base64. Use Node's audited crypto primitives,
// following https://jedisct1.github.io/minisign/#signature-format . No secret key is read here.
export function verifyUpdaterSignature(data, encodedSignature, encodedKey) {
  const keyLines = decodeBase64(encodedKey.trim()).toString('utf8').trim().split(/\r?\n/);
  const lines = decodeBase64(encodedSignature.trim()).toString('utf8').trim().split(/\r?\n/);
  requireValue(keyLines.length === 2 && keyLines[0].startsWith('untrusted comment: '), 'Invalid public key format');
  requireValue(lines.length === 4 && lines[0].startsWith('untrusted comment: ')
    && lines[2].startsWith('trusted comment: '), 'Invalid signature format');
  const key = decodeBase64(keyLines[1]);
  const packet = decodeBase64(lines[1]);
  requireValue(key.length === 42 && key.subarray(0, 2).toString() === 'Ed', 'Invalid public key packet');
  requireValue(packet.length === 74 && packet.subarray(0, 2).toString() === 'ED', 'Expected hashed Minisign signature');
  requireValue(key.subarray(2, 10).equals(packet.subarray(2, 10)), 'Updater signing key mismatch');
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' });
  const signature = packet.subarray(10);
  requireValue(verify(null, createHash('blake2b512').update(data).digest(), publicKey, signature), 'Installer signature verification failed');
  const comment = Buffer.from(lines[2].slice('trusted comment: '.length), 'utf8');
  const globalSignature = decodeBase64(lines[3]);
  requireValue(globalSignature.length === 64 && verify(null, Buffer.concat([signature, comment]), publicKey, globalSignature), 'Trusted signature comment verification failed');
  return true;
}

function releaseFiles(options) {
  const { directory, version, pubkey, repository, commit } = options;
  requireValue(repository === 'NudeNyang/NudeNyang-Discord-Translator', 'The existing update repository must be preserved');
  requireValue(/^[a-f0-9]{40}$/.test(commit), 'Release source commit is required');
  return Object.entries(installerNames(version)).map(([platform, name]) => {
    const path = join(directory, name);
    requireValue(statSync(path).isFile() && statSync(path).size > 0, `Missing installer: ${name}`);
    const data = readFileSync(path);
    const signature = readFileSync(`${path}.sig`, 'utf8').trim();
    verifyUpdaterSignature(data, signature, pubkey);
    return { platform, name, signature, sha256: sha256(data), url: `https://github.com/${repository}/releases/download/v${version}/${name}` };
  });
}

export function generateRelease(options) {
  const files = releaseFiles(options); // Validate BOTH before writing any metadata.
  requireValue(typeof options.notes === 'string' && options.notes.trim(), 'Release notes are required');
  const manifest = { version: options.version, notes: options.notes.trim(), pub_date: new Date().toISOString(),
    source_commit: options.commit, platforms: Object.fromEntries(files.map((file) => [file.platform,
      { signature: file.signature, url: file.url, sha256: file.sha256 }])) };
  writeFileSync(join(options.directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const names = files.flatMap(file => [file.name, `${file.name}.sig`]).concat('latest.json');
  const checksums = names.map(name => `${sha256(readFileSync(join(options.directory, name)))}  ${name}`).join('\n');
  writeFileSync(join(options.directory, 'SHA256SUMS.txt'), `${checksums}\n`);
  return validateRelease(options);
}

export function validateRelease(options) {
  const files = releaseFiles(options);
  const manifest = JSON.parse(readFileSync(join(options.directory, 'latest.json'), 'utf8'));
  requireValue(manifest.version === options.version, 'Manifest version mismatch');
  requireValue(manifest.source_commit === options.commit, 'Manifest source commit mismatch; rebuild from the current commit');
  requireValue(typeof manifest.notes === 'string' && manifest.notes.trim() && Number.isFinite(Date.parse(manifest.pub_date)), 'Missing notes/publication date');
  requireValue(Object.keys(manifest.platforms ?? {}).sort().join() === [...PLATFORMS].sort().join(), 'Both Windows update platforms are required');
  for (const file of files) {
    const entry = manifest.platforms[file.platform];
    requireValue(entry.url === file.url && entry.signature === file.signature && entry.sha256 === file.sha256,
      `Update entry mismatch: ${file.platform}`);
  }
  const names = files.flatMap(file => [file.name, `${file.name}.sig`]).concat('latest.json');
  const lines = readFileSync(join(options.directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
  requireValue(lines.length === names.length, 'Missing or extra checksums');
  const checksums = new Map(lines.map(line => {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    requireValue(match, 'Invalid checksum line');
    return [match[2], match[1]];
  }));
  for (const name of names) requireValue(checksums.get(name) === sha256(readFileSync(join(options.directory, name))), `Checksum mismatch: ${name}`);
  return { manifest, artifacts: names.concat('SHA256SUMS.txt').map(name => ({ name,
    size: statSync(join(options.directory, name)).size, sha256: sha256(readFileSync(join(options.directory, name))) })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    requireValue(['generate', 'validate'].includes(command) && args.length % 2 === 0, 'Usage: release-updates.mjs generate|validate [--project-root path] [--notes-file path]');
    const flags = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
    for (const key of Object.keys(flags)) requireValue(['--project-root', '--notes-file', '--commit'].includes(key), `Unknown option: ${key}`);
    const root = resolve(flags['--project-root'] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
    const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const options = { version: config.version, directory: join(root, 'release', config.version),
      repository: 'NudeNyang/NudeNyang-Discord-Translator', pubkey: config.plugins.updater.pubkey,
      commit: flags['--commit'] ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() };
    const result = command === 'generate'
      ? generateRelease({ ...options, notes: readFileSync(flags['--notes-file'] ?? join(root, 'docs/releases', `${config.version}.md`), 'utf8') })
      : validateRelease(options);
    console.log(JSON.stringify({ version: config.version, source_commit: options.commit, artifacts: result.artifacts }));
  } catch (error) {
    console.error(`Release validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
