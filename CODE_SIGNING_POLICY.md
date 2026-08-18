# Code signing policy

NudeNyang Discord Translator publishes Windows binaries from the public source repository at <https://github.com/NudeNyang/NudeNyang-Discord-Translator>.

## Current status

The project is preparing an application for the SignPath Foundation open-source code-signing program. Until approval and pipeline activation, release notes clearly identify Windows packages that do not yet carry a Microsoft Authenticode signature.

After acceptance, official signed releases will include the following acknowledgement:

> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Team roles

- Committer and reviewer: [NudeNyang](https://github.com/NudeNyang)
- Signing approver: [NudeNyang](https://github.com/NudeNyang)

Contributions from other authors must be reviewed before they are merged. Every release signing request requires manual approval.

## Signed-release source and build policy

- Signed official artifacts are built from a tagged commit in this repository.
- Signing builds run on GitHub-hosted runners through repository-owned GitHub Actions workflows.
- Signing requests use the build provenance supplied by the SignPath GitHub connector.
- Only NudeNyang-owned executables and installers are signed with the project certificate.
- Bundled upstream open-source runtimes keep their upstream signatures or remain unsigned; they are not re-signed as NudeNyang software.
- Product name, company name and version metadata are checked before signing.
- Release checksums and the Tauri updater signature are generated from the final published artifacts.

## Security and privacy

The project does not use Discord user tokens or unofficial Discord APIs. Discord integration uses a private inherited pipe instead of a public debugging port. Automatic startup and Discord connection preparation are enabled only by the user from the application settings and are reversible from the same setting.

See the [Privacy Policy](PRIVACY.md) for local processing, optional external translation services and credential storage.

## Verification

Once Authenticode signing is active, Windows users can inspect a downloaded executable with:

```powershell
Get-AuthenticodeSignature -LiteralPath .\NudeNyangDiscordTranslator.exe | Format-List
```

Each release also includes `SHA256SUMS.txt`. The Tauri updater signature is separate from Authenticode and is retained for automatic-update integrity verification.
