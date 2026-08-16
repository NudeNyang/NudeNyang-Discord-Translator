# Discord Client Modification and Practical Risk

> Last reviewed: August 17, 2026

NudeNyang Discord Translator is not approved or endorsed by Discord. This document explains the
practical risk by looking at what the app does, Discord's published policies, and the public client-mod
ecosystem. It is not legal advice and does not guarantee how Discord will enforce its policies.

The Korean version is available at [Discord 클라이언트 변경과 이용 위험](DISCORD_POLICY.md).

## Short answer

Discord does not permit unauthorized client modification. NudeNyang Discord Translator is not an
exception, so we cannot promise that its use will never affect an account or access to Discord.

The practical risk depends heavily on behavior. The app does not use user tokens or unofficial Discord
APIs. It does not expose hidden information or send messages in bulk. Our current assessment is that
Discord is unlikely to identify and act against an individual solely for using the translation features
described here. That is a project assessment based on public policies and the history of client mods,
not permission from Discord.

## How the app connects to Discord

On Windows, the app starts Discord with `--remote-debugging-pipe` and connects to the active renderer
through a private anonymous pipe that is not exposed as a TCP port. It reads visible messages, channel
names, and image elements, then applies translations to the DOM. Disabling translation or shutting down
the app restores the original content saved by the app.

Outgoing translation runs only after the user presses Enter or a configured shortcut. The app does not
navigate the account on its own, compose unsolicited messages, or split long text into a burst of
separate messages.

The current implementation observes these boundaries:

- It does not use Discord user tokens or unofficial Discord APIs.
- It does not modify Discord installation files, account settings, or server data.
- It does not open a TCP debugging port.
- It validates the executable path, process, and `https://discord.com` page before connecting.
- It does not expose hidden channels, deleted messages, or information outside the user's permissions.
- It does not bypass Nitro or other paid features.
- It does not provide automated messaging, bulk sending, or background account control.
- Local translation keeps message text on the user's PC. When an external translator is selected, only
  the text being translated is sent to that provider.

See [Architecture and safety boundaries](ARCHITECTURE.md#discord-dom-경계) for implementation details.

## Policy status

The [Discord Terms of Service](https://discord.com/terms) restrict modification and reverse engineering
of Discord's software and prohibit unauthorized software designed to modify the service. Discord's
[Platform Manipulation Policy](https://discord.com/safety/platform-manipulation-policy-explainer-oct-2023)
also says that modifying the Discord client is not allowed, regardless of the reason. The published
policies do not distinguish DOM-only changes from patches to Discord's internal modules.

For that reason, the project does not make any of these claims:

- `Approved by Discord`
- `Compliant because it only changes the DOM`
- `Undetectable`
- `No risk of account action`

The `--remote-debugging-pipe` argument and renderer connection can be observed on the local system.
Although DOM changes do not normally add a distinct marker to message requests, that does not make the
app impossible to detect.

## BetterDiscord and Vencord

The [BetterDiscord FAQ](https://docs.betterdiscord.app/users/getting-started/faq) states that BetterDiscord
violates Discord's Terms of Service while also giving the maintainers' view that users are generally fine
unless they engage in egregious behavior such as self-botting or running unapproved plugins. BetterDiscord's
[plugin review rules](https://docs.betterdiscord.app/plugins/publishing/guidelines) reject token access,
message logging, Nitro bypasses, automation, and abusive API traffic.

[Vencord](https://github.com/Vendicated/Vencord) is a public client mod that patches Discord's internal
modules and React components. Its
[Translate plugin](https://github.com/Vendicated/Vencord/tree/main/src/plugins/translate) reads Discord
message objects and can change outgoing content immediately before it is sent. Vencord discloses that
client mods violate Discord's terms, while its maintainers say they know of no confirmed account bans for
client mod use alone when abusive behavior was not involved. This is Vencord's account of its experience,
not a promise from Discord.

The long-running public presence of BetterDiscord and Vencord suggests that Discord is not conducting a
blanket enforcement campaign against every client modification user. It does not grant NudeNyang Discord
Translator an exemption. Enforcement may change and may depend on project scale, features, and harm to
users or the service.

## Practical risk assessment

The table below records the project's assessment based on public policy and the current implementation.
It is not a probability model and is not based on internal Discord data.

| Scenario | Current assessment | Reasoning |
|---|---|---|
| Personal use limited to translation | Low | It does not create separate Discord API traffic or unattended automation |
| Direct action against an individual account | Low | Most changes remain client-side, and no public blanket enforcement campaign has been identified |
| Discord asking the project to stop distribution at its current scale | Low | The current scope is translation and does not interfere with server operations or paid Discord features |
| Action by a strict server against a member | Varies by server | Server operators may impose rules stricter than Discord's observed enforcement |
| Suspicion from security software or users | Moderate | Debug access to an authenticated renderer requires clear explanation and verifiable safeguards |
| Breakage after a Discord update | High | Discord's DOM and selectors are not a compatibility contract |

Discord updates, security warnings around installation, and distrust about chat access are more likely to
cause problems than direct account enforcement.

## Likely user and developer reactions

Users who need translation usually ask about their account, where chat text is sent, and the effect of a
bad translation before they ask how the DOM integration works. Restarting Discord or enabling a debugging
connection can also resemble malware behavior without enough context. Open source code, signed builds,
and a clear distinction between local and external translation are therefore central to user trust.

DOM modification is familiar to client-mod developers. They are more likely to examine update resilience,
original-content restoration, CPU usage, and event handling than object to the concept alone. Security
reviewers will focus more closely on pipe access, target validation, the update supply chain, and data sent
to external translation providers.

Discord does not normally show server administrators that this app is running. A server may still take
action if a user posts a screenshot that reveals a modified UI or if its own rules prohibit client mods.
People using an important personal or organizational account should make that decision with particular
care.

## Changes that would increase the risk

Any of the following would materially change the assessment and require a new policy review:

- Sending messages or reactions without a fresh user action
- Crawling multiple channels or collecting messages in bulk
- Preserving deleted messages or exposing hidden channels or unauthorized information
- Bypassing Nitro, Quests, age checks, or other paid or security controls
- Using user tokens, session credentials, or Discord's internal APIs
- Collecting chat content on a project-operated server by default
- Branding that could be mistaken for an official Discord product
- Large-scale monetization that resells or substitutes Discord functionality

Adding any of these would weaken the project's position as a focused translation tool and make scrutiny
from Discord and security reviewers more likely.

## Public communication rules

Project pages and consent screens should describe the risk plainly without overstating it.

1. State that the app is not approved or endorsed by Discord.
2. Explain that it uses an unofficial integration and may be restricted under Discord policy.
3. Describe the boundaries around tokens, unofficial APIs, and Discord installation files.
4. Distinguish where local and external translation process chat text.
5. Explain that outgoing translation begins with a user action and does not run as unattended automation.
6. Do not promise safety, undetectability, or protection from account action.
7. Warn that Discord updates may break the integration and direct project support to GitHub.

Discord is a trademark of Discord Inc. NudeNyang Discord Translator is not affiliated with or endorsed by
Discord Inc.
