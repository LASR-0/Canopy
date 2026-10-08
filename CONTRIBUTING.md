# Contributing to Canopy

Thanks for helping. Canopy is a small project, so a short note before you
start saves everyone time.

## Before you start

- **Read [ROADMAP.md](ROADMAP.md).** It is the project's record of what is
  built, what is planned, and why each decision was made. A change that
  goes against a recorded decision needs a discussion first.
- **Open an issue for anything larger than a fix**, so we can agree on the
  approach before you write it.
- **Device support is the most useful contribution.** If your firmware or
  device does not pair, an issue with its discovery messages (the
  `homeassistant/.../config` payloads) and its state messages is a great
  start.

## Development

Setup, commands and the repository layout are in the README, under
[Building from source](README.md#building-from-source). In short:

```bash
pnpm install
pnpm dev        # controller and app
pnpm dev:sim    # simulated devices, in a second terminal
```

Before opening a pull request:

```bash
pnpm typecheck
pnpm test
```

- Use **pnpm**, not npm.
- TypeScript is strict throughout; keep it that way, without `any` or
  `@ts-ignore`.
- Domain types and the API contract live in `packages/shared-types`. Change
  them there, not in one side of the app.
- Match the code around you: its naming, its comments and its structure.

## Pull requests

- One change per pull request, with a description of what it does and why.
- Say how you tested it, especially with real hardware.
- **Agree to the [Contributor License Agreement](CLA.md)** by adding its
  line to your first pull request. You keep the copyright in your work. The
  agreement lets the maintainer offer Canopy under other licences as well
  as the AGPL-3.0, and promises your contribution stays open source.

## Licence

Canopy is licensed under the [GNU Affero General Public License
v3.0](LICENSE). By contributing, you agree that your contributions are
published under it, on the terms of the [CLA](CLA.md).
