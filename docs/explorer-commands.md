# Explorer commands

[Documentation](README.md) › Explorer commands

`evm explorer` manages the block explorer API keys stored in a profile. This page documents each command's arguments, options, output, and exit code. For what the keys are used for and the order sources are tried, see [Block explorer access](configuration.md#block-explorer-access).

One key covers every chain a source supports, so these commands take no chain argument. Only `evm contract proxy-info` uses an explorer, and only for the fields it can't read from an RPC endpoint.

| Command | What it does |
| --- | --- |
| [`list`](#evm-explorer-list) | Shows which explorers a profile configures, with keys masked |
| [`set`](#evm-explorer-set-explorer-apikey) | Stores a key, after checking that the explorer accepts it |
| [`remove`](#evm-explorer-remove-explorer) | Drops a key from a profile |

All three accept `-p, --profile <nameOrPath>` to work on a profile other than the current one, and `--json`.

## `evm explorer list`

Lists every known explorer, its endpoint, and the key the profile holds for it.

```bash
evm explorer list [-p profile] [--reveal] [--json]
```

| Option | Effect |
| --- | --- |
| `--reveal` | Print literal keys in full. A `${VAR}` reference is shown as written either way |

```bash
evm explorer list
```

```text
Profile default /Users/you/.config/evm-elf/profiles/default.yaml

Explorer      Endpoint                             API Key
──────────────────────────────────────────────────────────
etherscan     https://api.etherscan.io/v2/api      ${ETHERSCAN_API_KEY} (unset)
blockscout    https://api.blockscout.com/v2/api    not set

Tried in this order, after a chain that names its own explorer_api.
```

The `API Key` column distinguishes three states, and the difference matters when a lookup returns nothing:

- **A `${VAR}` reference** is shown as written, because the reference itself is not a secret. `(unset)` means the variable has no value in this environment, so the source is skipped.
- **A literal key** is reduced to its last four characters, as `****cdef`. `--reveal` prints it in full.
- **`not set`** means the profile configures nothing for that source.

The JSON form returns the section as stored.

```json
{
  "profile": "default",
  "path": "/Users/you/.config/evm-elf/profiles/default.yaml",
  "explorers": {
    "etherscan": "${ETHERSCAN_API_KEY}"
  }
}
```

> [!CAUTION]
> `--json` applies no masking. A profile holding a literal key prints it in full.

## `evm explorer set <explorer> <apiKey>`

Stores an API key for one explorer, after checking that the explorer accepts it.

```bash
evm explorer set <explorer> <apiKey> [-p profile] [--no-verify] [--json]
```

`<explorer>` must be `etherscan` or `blockscout`. `<apiKey>` is either a literal key or a `${VAR}` reference resolved at run time, which is the form that keeps the key out of the profile file.

The profile itself must already exist. `default` is created on demand, but any other name `-p` gives is expected to be there, so a typo fails with `Profile not found` instead of writing a new profile holding nothing but that key.

| Option | Effect |
| --- | --- |
| `--no-verify` | Write the entry without checking the key |

```bash
evm explorer set etherscan '${ETHERSCAN_API_KEY}'
```

```text
Added etherscan to /Users/you/.config/evm-elf/profiles/default.yaml
  api_key      ${ETHERSCAN_API_KEY}
  key accepted by the explorer
```

Quote the argument. Without quotes your shell expands `${ETHERSCAN_API_KEY}` and stores the resulting literal key in the file, which is the opposite of what the reference is for.

### The key is checked before it's written

The command asks the explorer for a long-verified contract and confirms the key is accepted, the same way [`evm chain set`](chain-commands.md#evm-chain-set-chain-rpcurl) reads the chain id from an endpoint rather than trusting the argument. A rejected key otherwise surfaces much later, and only as `proxy-info --full` quietly printing fewer fields.

A rejected key stops the write and reports what the explorer said:

```text
etherscan rejected the key: Invalid API Key (#err2)
Pass --no-verify to write the entry anyway.
```

A `${VAR}` that doesn't resolve can't be checked, so it's the same refusal with the same escape hatch:

```text
Could not resolve ${ETHERSCAN_API_KEY}: the environment variable is not set
Pass --no-verify to write the entry anyway.
```

`--no-verify` is the right answer when you're writing a profile for a machine other than this one, where the variable will exist. The entry is written and the output says it wasn't checked:

```bash
evm explorer set etherscan '${ETHERSCAN_API_KEY}' --no-verify
```

```text
Updated etherscan in /Users/you/.config/evm-elf/profiles/default.yaml
  api_key      ${ETHERSCAN_API_KEY} (unset)
  key not checked (--no-verify)
```

The JSON form reports whether the entry was new and whether the key was checked:

```json
{
  "profile": "default",
  "path": "/Users/you/.config/evm-elf/profiles/default.yaml",
  "added": false,
  "explorer": "etherscan",
  "verified": false
}
```

## `evm explorer remove <explorer>`

Removes one explorer's key from a profile. The other sources, and any chain with its own `explorer_api`, keep working.

```bash
evm explorer remove <explorer> [-p profile] [--json]
```

```bash
evm explorer remove blockscout
```

```text
Removed blockscout from /Users/you/.config/evm-elf/profiles/default.yaml
```

Removing a key that isn't configured is an error, and the message lists what is:

```text
Explorer 'etherscan' is not configured in /Users/you/.config/evm-elf/profiles/default.yaml (configured: none)
```

## Exit codes

These commands exit `1` whenever they change nothing, which makes them safe to chain in a script.

| Command | Exits `1` when |
| --- | --- |
| `list` | The profile is missing or can't be parsed. |
| `set` | The profile doesn't exist, the explorer name is unknown, the key is empty, the `${VAR}` doesn't resolve, or the explorer rejects the key. The last two are skipped by `--no-verify`. |
| `remove` | The explorer name is unknown, or the profile doesn't configure it. |

## Next steps

These keys exist for one command, and one page explains what they buy you.

- [Contract commands](contract-commands.md#evm-contract-proxy-info-address) documents the `proxy-info --full` fields that need an explorer.
- [Configuration](configuration.md#block-explorer-access) covers the order sources are tried and what happens when none is configured.
- [Troubleshooting](troubleshooting.md#proxy-info---full-shows-fewer-fields-than-expected) helps when fields go missing.
