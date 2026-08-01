# Chain commands

[Documentation](README.md) › Chain commands

`evm chain` edits the chains inside one profile, and those chains are what every read fans out across. This page documents each command's arguments, options, output, and exit code. For the files themselves, see [Profile commands](profile-commands.md); for every field a chain entry may carry, see [Configuration](configuration.md).

| Command | What it does |
| --- | --- |
| [`list`](#evm-chain-list) | Lists the chains a profile configures |
| [`set`](#evm-chain-set-chain-rpcurl) | Adds a chain or changes an existing one |
| [`remove`](#evm-chain-remove-chain) | Removes a chain from a profile |

All three accept `-p, --profile <nameOrPath>` to work on a profile other than the current one, and `--json`. An edited file is rewritten atomically with owner-only permissions.

## `evm chain list`

Lists the chains a profile configures, along with the endpoint and metadata for each.

```bash
evm chain list [-p profile] [--reveal] [--json]
```

| Option | Effect |
| --- | --- |
| `--reveal` | Print literal header values in full. A `${VAR}` reference is shown as written either way |

```bash
evm chain list -p myproject
```

```text
Profile myproject /Users/you/.config/evm-elf/profiles/myproject.yaml

Chain           Chain ID   RPC URL                                       Token    Headers
─────────────────────────────────────────────────────────────────────────────────────────
base            8453       https://mainnet.base.org                      ETH
local           31337      http://127.0.0.1:8545                         -
```

Header values are masked in this table, because one may be a literal API key. A `${VAR}` reference is shown as written, with `(unset)` appended when the variable has no value, which is how you catch a missing key without printing any. A literal value is reduced to its last four characters. `--reveal` prints literals in full; it has no effect on a reference, which is shown as written rather than resolved, since the reference is not the secret.

An RPC URL longer than the column is cut with an ellipsis. `--reveal` doesn't affect that either — use `--json`, which prints every value in full, to read a long endpoint.

> [!CAUTION]
> The masking applies to the table only. `evm chain list --json` prints the profile exactly as stored, literal header values included.

## `evm chain set <chain> [rpcUrl]`

Adds a chain to a profile or changes an existing one, rewriting a single entry and leaving your comments and key order alone.

```bash
evm chain set <chain> [rpcUrl] [-p profile] [--chain-id <id>]
              [-H <name:value>] [--remove-header <name>]
              [--symbol <symbol>] [--coingecko-id <id>] [--explorer-api <url>]
              [--no-verify] [--json]
```

The RPC URL is optional when the chain already exists, which is how a single field gets changed without restating the endpoint.

The profile itself must already exist. `default` is created on demand, but any other name `-p` gives is expected to be there, so a typo fails with `Profile not found` instead of writing a new one-chain profile. Create it first with [`evm profile create`](profile-commands.md#evm-profile-create-name).

| Option | Effect |
| --- | --- |
| `--chain-id <id>` | Set the chain ID instead of reading it from the endpoint. A value that disagrees with the endpoint is an error. |
| `-H, --header <name:value>` | Add or replace an HTTP header sent with every request. Repeatable. |
| `--remove-header <name>` | Drop a header. Repeatable. |
| `--symbol <symbol>` | Native token symbol. An empty value, `--symbol ''`, clears it. |
| `--coingecko-id <id>` | CoinGecko coin ID, which is what enables the USD column for this chain. |
| `--explorer-api <url>` | Etherscan-compatible API for a chain outside Etherscan v2. |
| `--no-verify` | Skip the `eth_chainId` request. Requires `--chain-id`. |

Adding a chain writes four fields, though only one was given. Chain names are yours to choose, so a second entry for Base through another provider is a new chain as far as the profile is concerned:

```bash
evm chain set base-backup https://mainnet.base.org
```

```text
Added base-backup to /Users/you/.config/evm-elf/profiles/default.yaml
  chain_id     8453
  rpc_url      https://mainnet.base.org
  symbol       ETH
  coingecko_id ethereum
```

The chain ID came from the endpoint, which the command asks with `eth_chainId` and a 5-second timeout rather than guessing from the name. Any chain works as a result, and an endpoint answering for the wrong network fails immediately instead of returning another chain's data later.

`symbol` and `coingecko_id` came from the bundled profile. Metadata an entry doesn't have yet is filled in whenever the chain ID matches a bundled chain, which also covers a fork of a known chain. The explicit options override it.

Four more forms cover the rest of what the command does:

```bash
# keep the secrets in the environment; quote so the shell doesn't expand them
evm chain set base '${BASE_RPC_URL}' -H 'auth-key:${BASE_KEY}'

# change only a header on an existing chain
evm chain set base -H 'auth-key:literal-key'

# add a chain that isn't running yet, or a local node that's currently down
evm chain set local http://127.0.0.1:8545 --chain-id 31337 --no-verify

# edit another profile
evm chain set base https://base.example/rpc -p myproject
```

When the endpoint can't be reached, the error names the fallback:

```text
Could not read the chain id from http://127.0.0.1:9: connect ECONNREFUSED 127.0.0.1:9
Pass --no-verify --chain-id <id> to write the entry anyway.
```

## `evm chain remove <chain>`

Removes one chain from a profile, which also removes it from every fan-out that profile drives.

```bash
evm chain remove <chain> [-p profile] [--json]
```

```bash
evm chain remove sepolia
evm chain remove sepolia -p myproject
```

Removing a chain that isn't in the profile is an error, and the message lists the chains that are configured.

## Exit codes

These commands exit `1` whenever they change nothing, which makes them safe to chain in a script.

| Command | Exits `1` when |
| --- | --- |
| `list` | The profile is missing or can't be parsed. |
| `set` | The profile doesn't exist, the chain or header syntax is invalid, a new chain has no RPC URL, `--no-verify` came without `--chain-id`, the endpoint is unreachable, or the reported chain ID contradicts `--chain-id`. |
| `remove` | The profile is missing, or it doesn't configure that chain. |

## Next steps

These commands write one section of a file that another page explains, and a third page shows them used in context.

- [Configuration](configuration.md) documents every chain field, including the headers and `explorer_api` these commands write.
- [Getting started](getting-started.md) walks through pointing a chain at your own RPC endpoint in context.
- [Troubleshooting](troubleshooting.md) covers chain errors with fixes.
