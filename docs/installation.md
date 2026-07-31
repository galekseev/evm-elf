# Installation

[Documentation](README.md) › Installation

This page installs the `evm` command globally, confirms it runs, and shows how to upgrade, uninstall, or run it from a checkout instead. On a machine that already has Node.js 22, the install takes about a minute.

## Requirements

Check these before installing, because npm builds the package from source during the install.

| Requirement | Why | Check it with |
| --- | --- | --- |
| Node.js 22 or newer | The `engines` field of [package.json](../package.json) sets this floor | `node --version` |
| npm | Runs the install and the TypeScript build | `npm --version` |
| git | npm clones the repository to build it | `git --version` |

You don't need an API key to start. The profile that ships with the package points 14 chains at their own public RPC endpoints, which is enough to try every read command. See [Configuration](configuration.md) for pointing chains at your own provider.

## Install the CLI globally

Install from the repository, which compiles the TypeScript sources and links the `evm` binary:

```bash
npm install -g github:galekseev/evm-elf
```

When the package is available on the npm registry, this installs the same binary:

```bash
npm install -g @camoseed/evm-elf
```

## Verify the install

Print the version to confirm the binary is on your `PATH`:

```bash
evm --version
# prints the installed version, for example: 0.2.0
```

Then list the chains the CLI knows about. This is also the command that creates your configuration:

```bash
evm chain list
```

The first run copies the bundled profile into your configuration directory and says so on stderr:

```text
Created /Users/you/.config/evm-elf/profiles/default.yaml from the bundled default profile
```

The table that follows lists 14 chains with their chain IDs and RPC URLs. If it appears, the install worked.

## Upgrade to a newer version

Re-run the install command. npm replaces the global install with the current state of the repository:

```bash
npm install -g github:galekseev/evm-elf
```

Your profiles live outside the package, in `~/.config/evm-elf`, so an upgrade never touches them. New chains added to the bundled profile don't reach an existing `default.yaml`, since the CLI only copies that file when it's missing. To pick up the current bundled chain list, see [`evm profile create`](profile-commands.md#evm-profile-create-name).

## Uninstall

Uninstall by package name rather than repository name:

```bash
npm uninstall -g @camoseed/evm-elf
```

This leaves `~/.config/evm-elf` in place. Delete that directory too if you want your profiles and their RPC URLs gone.

## Run from a checkout

If you want to read or change the source, run the CLI through `tsx` instead of installing it:

```bash
git clone https://github.com/galekseev/evm-elf.git
cd evm-elf
npm install
npm run evm -- wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a
```

`npm run evm` runs `index.ts` directly, so every example in this documentation works with `npm run evm --` in place of `evm`. The `--` separates the CLI's arguments from npm's own, and leaving it out means `evm`'s flags never reach it.

> [!NOTE]
> A checkout reads the same profiles as a global install, so both see the same chains and RPC URLs. To keep an experiment separate, set `EVM_ELF_CONFIG_DIR` to a scratch directory, as described in [Configuration](configuration.md#environment-variables).

## Next steps

With the binary installed and a profile in place, these take you to a working setup.

- [Getting started](getting-started.md) walks through your first reads and your first dry run.
- [Configuration](configuration.md) explains profiles, so you can point the chains you use at your own RPC provider.
- [Troubleshooting](troubleshooting.md) covers install-time and first-run errors.
