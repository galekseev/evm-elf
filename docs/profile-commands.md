# Profile commands

[Documentation](README.md) › Profile commands

`evm profile` manages the profile files on your machine: creating them, copying them, and choosing which one commands use when `-p` isn't given. This page documents each command's arguments, options, output, and exit code. For the chains inside a profile, see [Chain commands](chain-commands.md); for what the files contain and how a profile is chosen, see [Configuration](configuration.md).

| Command | What it does |
| --- | --- |
| [`list`](#evm-profile-list) | Lists profiles and shows which one is in use |
| [`create`](#evm-profile-create-name) | Creates a profile from the bundled one, or an empty one |
| [`clone`](#evm-profile-clone-source-name) | Copies an existing profile or a file under a new name |
| [`remove`](#evm-profile-remove-name) | Deletes a profile |
| [`set-default`](#evm-profile-set-default-name) | Chooses the profile used when `-p` isn't given |

All five act on whole files in your profiles directory, and all five accept `--json`. Profile names must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, which keeps a name from escaping that directory.

## `evm profile list`

Lists every profile on this machine, how many chains each configures, and which one commands use by default.

```bash
evm profile list [--json]
```

```text
   Profile              Chains   Path
────────────────────────────────────────────────────────────────────────────────
   default              14       /Users/you/.config/evm-elf/profiles/default.yaml
*  myproject            14       /Users/you/.config/evm-elf/profiles/myproject.yaml
   scratch              2        /Users/you/.config/evm-elf/profiles/scratch.yaml

* in use: myproject (set by evm profile set-default)
```

The `*` marks the profile in use, and the closing line says where that choice came from: `$EVM_ELF_PROFILE`, `evm profile set-default`, or the built-in fallback. This is the command to run when a query returns chains you didn't expect.

A profile the CLI can't parse still appears, with `error` in the `Chains` column and the parse error beneath its row, so one broken file doesn't hide the others.

## `evm profile create <name>`

Creates a profile from the one bundled with the package, which is also how you pick up chains added to the bundle since your `default.yaml` was written.

```bash
evm profile create <name> [--empty] [--json]
```

| Option | Effect |
| --- | --- |
| `--empty` | Start with no chains at all, to be filled in with `evm chain set` |

```bash
evm profile create myproject
```

```text
Created profile myproject /Users/you/.config/evm-elf/profiles/myproject.yaml
  14 chains from the bundled profile: arbitrum, avax, base, bsc, xdai, linea, mainnet, optimistic, matic, sepolia, sonic, unichain, zksync, robinhood
  use it with: -p myproject, or make it the default: evm profile set-default myproject
```

Use `--empty` when a project touches three chains and a 14-chain fan-out would only be noise:

```bash
evm profile create myproject --empty
evm chain set base https://base.example/rpc -p myproject
evm chain set arbitrum https://arb.example/rpc -p myproject
```

The command refuses to overwrite: creating a profile whose file exists fails with `Profile already exists`.

## `evm profile clone <source> <name>`

Copies a profile under a new name, byte for byte, so comments and key order survive.

```bash
evm profile clone <source> <name> [--force] [--json]
```

`<source>` is either a profile name or a path, which is what makes a chain list shareable. A file committed to a repository becomes a local profile in one command:

```bash
evm profile clone default backup             # snapshot before editing
evm profile clone ./ops/chains.yaml team     # a file from a repository
```

| Option | Effect |
| --- | --- |
| `--force` | Overwrite the target profile when it already exists |

## `evm profile remove <name>`

Deletes a profile file.

```bash
evm profile remove <name> [--force] [--json]
```

| Option | Effect |
| --- | --- |
| `--force` | Remove it even when it's the profile currently in use |

Removing the profile in use is refused, because the next command would fail with a missing-profile error:

```text
'myproject' is the profile in use; pass --force to remove it, or point elsewhere first with evm profile set-default <name>
```

Forcing it through also clears the default pointer, so the default falls back to `default`. Removing `default` itself is allowed; the CLI recreates it from the bundled profile on the next run.

## `evm profile set-default <name>`

Writes the profile name to `~/.config/evm-elf/profiles/.default`, so the choice survives across shells and sessions.

```bash
evm profile set-default <name> [--json]
```

```bash
evm profile set-default myproject
evm profile set-default default     # back to the bundled chain list
```

```text
Default profile is now myproject /Users/you/.config/evm-elf/profiles/myproject.yaml
  was default
```

The profile must exist, with the single exception of `default`, which the CLI creates from the bundle if it's missing. Two things still outrank this pointer: `$EVM_ELF_PROFILE` and the `-p` option. When that variable is set, the command warns that the pointer it wrote won't take effect.

## Exit codes

These commands exit `1` whenever they change nothing, which makes them safe to chain in a script.

| Command | Exits `1` when |
| --- | --- |
| `list` | Never, in practice. A broken profile is reported in its row. |
| `create` | The name is invalid, or the profile already exists. |
| `clone` | The name is invalid, the source is missing, source and target are the same file, or the target exists without `--force`. |
| `remove` | The name is invalid, the profile is missing, or it's in use and `--force` wasn't given. |
| `set-default` | The name is invalid, or the profile doesn't exist. |

## Next steps

A profile is an empty shell until something fills it, and two pages cover what goes inside.

- [Chain commands](chain-commands.md) documents the commands that add and edit the chains in a profile.
- [Configuration](configuration.md) documents the file format these commands write, and the precedence rules behind the profile in use.
- [Troubleshooting](troubleshooting.md) covers profile errors with fixes.
