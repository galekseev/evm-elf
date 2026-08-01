# Configuration

[Documentation](README.md) › Configuration

This page is the reference for everything the CLI reads before it talks to a chain: where configuration files live, how a profile describes a chain, which environment variables matter, and how a command decides which chains to query. For the commands that edit these files, see [Profile commands](profile-commands.md) and [Chain commands](chain-commands.md).

One idea explains the rest: **a profile is the chain list**. The chains a profile names are the chains every read fans out across, so switching profiles switches both the endpoints and the set of chains in one move.

## Where configuration lives

Everything sits under one configuration directory, outside the installed package, so upgrades never overwrite it.

| Path | Holds |
| --- | --- |
| `~/.config/evm-elf/profiles/<name>.yaml` | One profile: the chains, their RPC URLs, headers, token metadata, and explorer API keys |
| `~/.config/evm-elf/profiles/.default` | The profile name chosen by `evm profile set-default` |
| `~/.config/evm-elf/.env` | Variables available to every run, whatever directory you're in |
| `./.env` | Variables for runs started in this directory, which wins over the one above |
| `config/default-profile.yaml` inside the package | The bundled profile: the source of default configuration, never part of your live configuration. Read only when a default is needed — the first-run copy, `evm profile create`, and the metadata `evm chain set` fills in by chain ID |

The directory is `$EVM_ELF_CONFIG_DIR` when set, then `$XDG_CONFIG_HOME/evm-elf`, then `~/.config/evm-elf`. Both variables are read from the environment only, not from a `.env` file, because the location they choose is where one of those files lives. `evm --help` prints the path it resolved.

The CLI creates `default.yaml` on first use, and only that one. Any other profile must exist before a command names it.

## Which profile a command uses

Four sources can name the profile, and the first one that answers wins.

| Priority | Source | Set it with |
| --- | --- | --- |
| 1 | The `-p, --profile` option | `evm wallet balance 0x… -p myproject` |
| 2 | The `EVM_ELF_PROFILE` environment variable | `export EVM_ELF_PROFILE=myproject` |
| 3 | The `.default` pointer file | `evm profile set-default myproject` |
| 4 | The built-in name `default` | Nothing; this is the fallback |

`-p` also accepts a path. An argument containing `/`, or an absolute path, is read as a file, which is how a profile committed to a repository gets used without installing it:

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a -p ./ops/chains.yaml
```

A bare name must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` and resolves to `<name>.yaml` in the profiles directory, falling back to `<name>.yml` if only that exists.

> [!TIP]
> When a command reports a profile you didn't expect, `evm profile list` prints which one is in use and where the choice came from.

## The profile file

A profile is YAML with two top-level keys. `chains` is required, and each key under it is a chain name, which is what `-c` and `-xc` accept. `explorers` is optional and holds block explorer API keys, covered in [Block explorer access](#block-explorer-access):

```yaml
# ~/.config/evm-elf/profiles/default.yaml
explorers:
  etherscan: ${ETHERSCAN_API_KEY}

chains:
  base:
    chain_id: 8453
    rpc_url: https://mainnet.base.org
    symbol: ETH
    coingecko_id: ethereum
  arbitrum:
    chain_id: 42161
    rpc_url: ${ARBITRUM_RPC_URL}
    symbol: ETH
    coingecko_id: ethereum
    headers:
      auth-key: ${ARBITRUM_AUTH_KEY}
  zksync:
    chain_id: 324
    rpc_url: https://mainnet.era.zksync.io
    symbol: ETH
    coingecko_id: ethereum
    explorer_api: https://block-explorer-api.mainnet.zksync.io/api
```

Chain names are yours to choose. The bundled profile uses `mainnet`, `matic`, `optimistic`, and `xdai`, but a profile of your own can call them anything, including two entries for the same chain ID pointing at different providers.

Your profile is the only chain list any command reads. The bundled profile is a source of defaults rather than a fallback: nothing merges it into yours at run time, so a chain you remove stays removed and a chain added to the bundle in a later release doesn't appear until you ask for it with `evm profile create`.

### Chain fields

Two fields are required, and the rest supply what an RPC endpoint can't tell the CLI.

| Field | Type | Required | What it does |
| --- | --- | --- | --- |
| `chain_id` | positive integer | Yes | Identifies the network. The provider is pinned to it, so a wrong value fails loudly instead of returning another chain's data. |
| `rpc_url` | string | Yes | The JSON-RPC endpoint. Accepts `${VAR}` references and the auth-key shorthand described below. |
| `headers` | mapping of string to string | No | HTTP headers sent with every RPC request, for endpoints behind a key or a proxy. |
| `symbol` | string | No | Native token symbol shown in the `Token` column of `evm wallet balance`. |
| `coingecko_id` | string | No | CoinGecko coin ID used to price the native token. Without it, that chain shows no USD value and stays out of the total. |
| `explorer_api` | string | No | An Etherscan-compatible API base URL, replacing Etherscan v2 for this chain. |

Any other field is an error: the CLI rejects the profile rather than ignoring a typo like `rpc_urls`. A chain entry missing `chain_id` or `rpc_url` doesn't fail the whole command either; that chain's row carries the error and the others still run.

### RPC URL formats

Both forms below are valid for `rpc_url`. The second is shorthand for a single `auth-key` header, matching the format used by `@1inch/solidity-utils`:

```yaml
rpc_url: https://base.example/rpc                  # plain URL
rpc_url: https://base.example/rpc|my-auth-key      # sets the auth-key header
```

A URL with more than one `|` is rejected with `Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>`.

> [!WARNING]
> Keep literal secrets out of the profile. An auth key or API token written into the file sits there in plain text, and profiles get committed to repositories, copied into backups, and shown on screen shares. Use a `${VAR}` reference instead, as [Reference environment variables from a profile](#reference-environment-variables-from-a-profile) describes: references resolve before the `|` is split, so `rpc_url: https://base.example/rpc|${BASE_AUTH_KEY}` works the same as the literal form. A signing key never belongs in a profile at all — no field accepts one, and [Private keys](private-keys.md) covers how commands receive one.

### Reference environment variables from a profile

`rpc_url` and every header value may contain `${VAR}` references, which the CLI resolves at run time. This keeps provider keys out of a file you might commit or share:

```yaml
  arbitrum:
    chain_id: 42161
    rpc_url: ${ARBITRUM_RPC_URL}
    headers:
      auth-key: ${ARBITRUM_AUTH_KEY}
```

An unset variable is an error for that chain only, reported as `Environment variable ARBITRUM_RPC_URL not set` in its row. The other chains still answer.

When you write these entries from the shell, quote them so your shell doesn't expand the reference before the CLI sees it:

```bash
evm chain set arbitrum '${ARBITRUM_RPC_URL}' -H 'auth-key:${ARBITRUM_AUTH_KEY}'
```

## Chain selection

Every command that reaches a chain takes the same two options, and they can't be combined.

| Option | Selects |
| --- | --- |
| `-c, --chain <chains>` | Exactly the comma-separated chains you name |
| `-xc, --exclude-chain <chains>` | Every chain in the profile, minus the ones you name |
| Neither | Every chain in the profile |

```bash
evm contract owner 0x1111111254EEB25477B68fb85Ed929f73A960582 -c base,arbitrum
evm contract owner 0x1111111254EEB25477B68fb85Ed929f73A960582 -xc mainnet,zksync
```

A name in `-c` that the profile doesn't define produces a row explaining that, along with the `evm chain set` command that would add it. A name in `-xc` that the profile doesn't define prints `Warning: excluded chain '<name>' is not in profile '<name>'` on stderr and changes nothing.

Two write commands are the exception: `contract transfer-ownership` and `contract proxy-upgrade` act on one chain, so they require `-c` with a single name.

> [!NOTE]
> Chains are queried one after another, not in parallel. A 14-chain fan-out against slow endpoints takes as long as the sum of its parts, which is one reason to narrow with `-c` once you know which chains matter.

## Environment variables

Most of these are read from the environment, then `./.env`, then `~/.config/evm-elf/.env`. A variable already set is never overwritten, so a value exported in your shell always wins over a file.

Two are the exception, and the `Read from` column marks them: the ones that decide where the configuration directory is have to be known before any `.env` file can be opened, since one of those files lives in that directory. Export them, or pass them for one command.

| Variable | Read from | What it does |
| --- | --- | --- |
| `EVM_ELF_PROFILE` | Environment or `.env` | Names the profile to use when `-p` isn't given. Wins over `evm profile set-default`. |
| `EVM_ELF_CONFIG_DIR` | Environment only | Moves the whole configuration directory, profiles and `.env` included. Useful for an isolated test setup. |
| `XDG_CONFIG_HOME` | Environment only | Changes the parent directory when `EVM_ELF_CONFIG_DIR` isn't set. |
| `EVM_PRICE_SOURCE` | Environment or `.env` | `coingecko` (the default when unset) or `none`. Any other value is treated as `none`. See [USD prices](#usd-prices). |
| `COINGECKO_API_KEY` | Environment or `.env` | Sends a CoinGecko demo key. The public endpoint works without one. |

```bash
EVM_ELF_CONFIG_DIR=/tmp/evm-scratch evm chain list   # for one command
export EVM_ELF_CONFIG_DIR=/tmp/evm-scratch           # for the shell
```

Profiles reference this same environment through `${VAR}`, so a key in `~/.config/evm-elf/.env` is available to every run:

```bash
# ~/.config/evm-elf/.env
ARBITRUM_RPC_URL=https://arb.example/rpc
ARBITRUM_AUTH_KEY=8f14e45fceea167a
ETHERSCAN_API_KEY=YourEtherscanKey
```

> [!NOTE]
> `ETHERSCAN_API_KEY` isn't in the table because the CLI never reads it directly. It's there because the bundled profile references it as `explorers.etherscan: ${ETHERSCAN_API_KEY}`. Point that entry at any variable name you like, or store the key in the profile outright. Exporting the variable without a profile entry to reference it does nothing.

## USD prices

`evm wallet balance` values native balances through a price source selected by `EVM_PRICE_SOURCE`.

| Value | Behavior |
| --- | --- |
| Unset | CoinGecko, as below. |
| `coingecko` | One batched request to the public CoinGecko `simple/price` endpoint, with a 5-second timeout. `COINGECKO_API_KEY` sends a demo key. |
| `none` | No price request at all, the same as passing `--no-usd` to every command. |
| Anything else | Treated as `none`, with a warning on stderr naming the value. Setting the variable at all means you wanted to control the lookup, so a value the CLI doesn't recognise stops it rather than falling back to the network. |

Pricing is best-effort by design. A failing, rate-limited, or slow source leaves the USD column empty rather than failing the command, and the run still reports balances and nonces.

Which coin a chain's native token maps to comes from the profile. A chain without `coingecko_id` shows `-` in the USD column and stays out of the total, with a closing line naming it. The bundled profile omits `coingecko_id` for `sepolia` for exactly this reason.

## Block explorer access

`evm contract proxy-info` is the only command that uses an explorer. Three of its `--full` fields come from one rather than from an RPC endpoint: the verified implementation name, the upgrade history, and the creation transaction. A fourth lookup doesn't wait for `--full` — the ProxyAdmin trace to the proxy an admin address manages runs whenever the address turns out to be a ProxyAdmin, and only `-s` skips it.

Keys live in the `explorers` section of the profile, one per source. A single key covers every chain that source supports, so this is profile-wide rather than per chain:

```yaml
explorers:
  etherscan: ${ETHERSCAN_API_KEY}
  blockscout: ${BLOCKSCOUT_API_KEY}
```

Edit it with [`evm explorer set`](explorer-commands.md#evm-explorer-set-explorer-apikey) rather than by hand, since that checks the key before writing it.

### The order sources are tried

Each lookup walks this list and stops at the first source that answers. A source that's down, out of quota, or missing that chain costs one request rather than the whole field.

| Order | Source | Key | Covers |
| --- | --- | --- | --- |
| 1 | The chain's own `explorer_api` | None | Only that chain, and only when the entry sets it |
| 2 | Etherscan v2 | `explorers.etherscan` | 64 chains, listed at `api.etherscan.io/v2/chainlist` |
| 3 | Blockscout | `explorers.blockscout` | 120+ chains, key required since July 2026 |

The order isn't configurable. A source with no key, or whose `${VAR}` doesn't resolve, is dropped before any request goes out.

`explorer_api` earns its place at the front for chains the multichain sources don't index. zkSync Era is the example in the bundled profile: it isn't on Etherscan v2, and its own endpoint answers without a key.

### When nothing is configured

If a chain ends up with no source at all, those fields are left out and the run says so once, on stderr:

```text
Skipped explorer lookups: no API key configured. Add one with: evm explorer set etherscan '${ETHERSCAN_API_KEY}'
```

The note appears only when a lookup was wanted, so `proxy-info -s` stays quiet. It goes to stderr, so `--json` output stays parseable.

A key that exists but is rejected is a different case, and a quiet one: the source answers with an error, the CLI moves to the next source, and no note appears. That's what the check in `evm explorer set` is for.

## How files are written

The CLI writes profiles to a temporary file and renames it into place, so an interrupted edit can't truncate a working profile. New profile files and the `.default` pointer are created with owner-only permissions, `0600`, because a profile can hold a literal API key in a header or in `explorers`.

Editing commands preserve what they don't change. `evm chain set` and `evm explorer set` each rewrite a single entry and keep your comments and key order, and `evm profile clone` copies the file byte for byte.

> [!CAUTION]
> `evm chain list` and `evm explorer list` mask secrets in their tables, but their `--json` output prints the profile as stored, literal keys included. Don't pipe it anywhere you wouldn't paste a secret.

## Next steps

Configuration is only half the setup; the other half is how you supply a signing key.

- [Profile commands](profile-commands.md) and [Chain commands](chain-commands.md) document the commands that create profiles and edit chains.
- [Explorer commands](explorer-commands.md) documents the commands that manage explorer API keys.
- [Private keys](private-keys.md) covers the one piece of configuration that never belongs in a profile.
- [Troubleshooting](troubleshooting.md) lists the profile and chain errors you can hit, with fixes.
