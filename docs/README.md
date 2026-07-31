# evm-elf documentation

evm-elf installs a command-line tool called `evm` that runs wallet and contract operations across many EVM chains at once. These pages cover installing it, pointing it at the chains you work with, and what every command does.

If you have never run `evm`, read [Installation](installation.md) and then [Getting started](getting-started.md). The install takes a minute, and the walkthrough about ten.

## Two defaults that shape every command

Both defaults surprise people once and never again, so it helps to know them before the first command.

- **Reads fan out.** A read command queries every chain in your profile unless you narrow it with `-c` or `-xc`. One `evm contract owner 0x...` answers "who owns this on each chain."
- **Writes are dry runs.** A command that would send a transaction prints its plan and stops. Only `--exec` broadcasts.

## Set up

These pages get the tool onto your machine and pointed at the right chains and keys.

| Page | What it covers |
| --- | --- |
| [Installation](installation.md) | Requirements, the global install, upgrades, and running from a checkout |
| [Getting started](getting-started.md) | Your first fan-out read, a narrowed query, your own RPC endpoint, and a dry run |
| [Configuration](configuration.md) | Profiles, every chain field, environment variables, chain selection, and USD prices |
| [Private keys](private-keys.md) | The two accepted key forms, and how to keep a key out of your shell history |

## Command reference

Each page documents the arguments, options, output, and exit codes of one command group, matching the groups `evm --help` lists. The last three write to a profile, each at a different level: a profile is a file, a chain is an entry in it, and one explorer key covers every chain at once.

| Page | Commands |
| --- | --- |
| [Wallet commands](wallet-commands.md) | `balance`, `send`, `set-nonce`, `generate`, `address` |
| [Contract commands](contract-commands.md) | `owner`, `proxy-info`, `transfer-ownership`, `proxy-upgrade`, `code` |
| [Profile commands](profile-commands.md) | `profile list`, `create`, `clone`, `remove`, `set-default` |
| [Chain commands](chain-commands.md) | `chain list`, `set`, `remove` |
| [Explorer commands](explorer-commands.md) | `explorer list`, `set`, `remove` |

## Fix a failing command

When a command fails or prints something you didn't expect, [Troubleshooting](troubleshooting.md) lists the messages the CLI produces, what causes each one, and how to fix it.

## Get help from the CLI

Every command documents itself, with examples of its own:

```bash
evm --help                 # the five command groups, and where configuration lives
evm wallet --help          # the commands in one group
evm wallet send --help     # one command, its options, and examples
```
