<h1 align="center">evm-elf</h1>

<p align="center">Wallet and contract operations on many EVM chains in one command. Built on ethers v6, installs as <code>evm</code>.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node.js 22 or newer"></a>
</p>

Working on a multichain deployment means running the same operation on every chain: checking a deployer's balance, confirming who owns a contract, finding out where a proxy points, topping up gas. evm-elf turns each of those into one command that covers all your chains at once, instead of a loop over RPC URLs.

## Features

- **Reads fan out.** Every query hits all the chains in your profile at once unless you narrow it with `-c`/`-xc`, so `evm contract proxy-info 0x...` answers "where is this deployed and what is it" in one pass.
- **Writes are dry-run.** A command that sends a transaction prints its plan and stops there; `--exec` is what sends. The contract commands also compare the signer against the owner and static-call the transaction, so a revert costs nothing.
- **A profile is the chain list.** One file holds the endpoints, headers and token metadata for a set of chains, so `-p myproject` switches the chains and their RPC URLs together.
- **Everything speaks JSON.** `--json` works on every command and carries the same per-chain data as the table.

## Install

```bash
npm install -g @camoseed/evm-elf
```

Requires Node.js 22+. To build from the current state of the repository instead, install from git: `npm install -g github:galekseev/evm-elf`.

## Quick start

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a           # balances on every chain
evm contract proxy-info 0x4200000000000000000000000000000000000010 -s   # where is it, and what is it
evm chain set base https://base.example/rpc                             # your endpoint instead of the public one
```

The first run creates `~/.config/evm-elf/profiles/default.yaml` from the profile bundled with the package: 14 chains pointed at their own public endpoints, which is enough to try things out and rate-limited under load. Every command supports `--help`.

## Documentation

This README is the overview. The [docs](docs/) directory covers setup and use in depth:

- [Installation](docs/installation.md) — requirements, the global install, upgrades, and running from a checkout
- [Getting started](docs/getting-started.md) — a ten-minute walkthrough from the first fan-out read to the first dry run
- [Configuration](docs/configuration.md) — profiles, every chain field, environment variables, and prices
- [Private keys](docs/private-keys.md) — passing a signing key without leaving it in your shell history
- [Wallet commands](docs/wallet-commands.md) and [Contract commands](docs/contract-commands.md) — every argument, option, output, and exit code
- [Profile commands](docs/profile-commands.md) — creating, copying, and switching between profiles
- [Chain commands](docs/chain-commands.md) — adding a chain to a profile and pointing it at your own endpoint
- [Explorer commands](docs/explorer-commands.md) — the block explorer API keys that `proxy-info --full` depends on
- [Troubleshooting](docs/troubleshooting.md) — the error messages, with a cause and a fix for each

## Contents

- [Documentation](#documentation) — the full guides, in `docs/`
- [Options](#options) — the flags every command shares
- [Wallet commands](#wallet-commands): [`balance`](#balance-wallet), [`send`](#send-to), [`set-nonce`](#set-nonce-target), [`generate`](#generate), [`address`](#address-private-key)
- [Contract commands](#contract-commands): [`owner`](#owner-address), [`proxy-info`](#proxy-info-address), [`transfer-ownership`](#transfer-ownership-address-newowner), [`proxy-upgrade`](#proxy-upgrade-proxy-newimplementation), [`code`](#code-address)
- [Configuration](#configuration): [the profile file](#the-profile-file), [`evm profile`](#profile-commands), [`evm chain`](#chain-commands), [`evm explorer`](#explorer-commands), [chain selection](#chain-selection), [private keys](#private-keys), [environment variables](#environment-variables), [prices](#prices)
- [Requirements](#requirements), [Development](#development), [License](#license)

## Options

Shared by the commands that reach a chain:

```
-c, --chain <chains>           Chains to use, comma-separated (default: every chain in the profile)
-xc, --exclude-chain <chains>  Chains to leave out (cannot be combined with -c)
-p, --profile <nameOrPath>     Profile to use (default: $EVM_ELF_PROFILE, else the default profile)
    --private-key <key>        Hex key, or the name of an env var holding one (commands that sign)
    --exec                     Send the transaction; without it the command prints its plan
    --json                     Print JSON instead of a table
```

`evm --help` lists the five command groups. `evm <group> <command> --help` documents a single command, with examples of its own.

## Wallet commands

Balances, native-token transfers and nonce management. The reads fan out across the profile; `send` and `set-nonce` sign, so they require `--private-key`.

### `balance <wallet>`

Native balance, USD value and pending nonce across chains, with a total. Accepts an address, a private key, or the name of an env var holding either.

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a
```

```
Wallet Balance: 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a

Chain           Chain ID   Balance (Native)          Token    Value (USD)      Nonce      Status
────────────────────────────────────────────────────────────────────────────────────────────────
arbitrum        42161      0.0076740380881518        ETH      $14.43           34         OK
avax            43114      1.987267192700984185      AVAX     $12.80           34         OK
base            8453       0.008921096499920447      ETH      $16.78           34         OK
bsc             56         0.026384506008903151      BNB      $15.60           34         OK
xdai            100        30.397500968793352058     xDAI     $30.04           34         OK
linea           59144      0.003118555158229058      ETH      $5.86            34         OK
mainnet         1          0.080837487973711977      ETH      $152.03          34         OK
optimistic      10         0.009932713394950238      ETH      $18.68           34         OK
matic           137        91.998910300164719596     POL      $6.62            34         OK
sepolia         11155111   0.029869928923982585      ETH      -                34         OK
sonic           146        219.575066457902650843    S        $4.63            34         OK
unichain        130        0.019892840367799299      ETH      $37.41           34         OK
zksync          324        0.12696957183574137       ETH      $238.79          34         OK
robinhood       4663       0.007545200223644         ETH      $14.19           34         OK
────────────────────────────────────────────────────────────────────────────────────────────────
Total                                                         $567.85
No price for: sepolia (excluded from total)
```

Chains whose native token has no meaningful price (testnets) show `-` and are left out of the total, as the last line notes. See [Prices](#prices).

```bash
evm wallet balance 0x72B4...Be7a -c base,arbitrum --json
evm wallet balance 0x72B4...Be7a --no-usd     # skip the price lookup
```

### `send <to>`

Send the native token. `--value` sends the same amount on each selected chain, `--all` sweeps the whole balance minus a gas reserve. Both print a plan and need `--exec` to send.

```bash
evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base
evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base --exec
evm wallet send 0x5d0F...95eB --all --private-key DEPLOYER_PK -c bsc,base,arbitrum
evm wallet send 0x5d0F...95eB --all --exec --fee-buffer 1.5 --private-key DEPLOYER_PK -xc mainnet
```

`--value` accepts ether amounts (`0.01`, `0.01ether`) or wei (`10000000000000000wei`). The `--all` plan reads balances and gas prices, so it prints the exact amount each chain would send; `--fee-buffer` is the multiplier on that gas reserve (default `1.1`, `--all` only) and whatever the reserve does not spend stays behind as dust. `--no-wait` returns once the transactions are broadcast instead of waiting for receipts, so it needs `--exec`. Amounts are named in each chain's own token, from its `symbol` in the profile, falling back to a lowercase `ether` on a chain that names none.

### `set-nonce <target>`

Bump a wallet's nonce to a target by sending zero-value self-transactions. Without `--exec` it prints how many transactions each chain needs.

```bash
evm wallet set-nonce 23 --private-key DEPLOYER_PK
evm wallet set-nonce 23 --private-key DEPLOYER_PK -c base --exec
```

Chains already at or above the target are skipped, since a nonce can never be lowered.

### `generate`

Generate a new random wallet. The mnemonic and private key are printed to stdout — store them securely.

```bash
evm wallet generate
evm wallet generate --words 24 --json
```

### `address <private-key>`

Derive the address for a private key or for an env var holding one.

```bash
evm wallet address DEPLOYER_PK
```

## Contract commands

Ownership and proxy inspection for a contract that lives at the same address on several chains. The reads fan out; `transfer-ownership` and `proxy-upgrade` act on one chain, so `-c` is required there.

### `owner <address>`

Read `owner()` across chains.

```bash
evm contract owner 0x1111111254EEB25477B68fb85Ed929f73A960582
evm contract owner 0x1111...0582 -c base,arbitrum --json
```

### `proxy-info <address>`

Auto-detects the proxy type and prints what is relevant for each:

| Detected type | Shown |
|---|---|
| Transparent (EIP-1967) | implementation, ProxyAdmin, admin owner, proxy-level `owner()` |
| UUPS / ERC-1967 | implementation, proxy-level `owner()` (usually authorizes upgrades) |
| Beacon proxy | beacon, beacon owner, `beacon.implementation()`, proxy-level `owner()` |
| Minimal proxy (EIP-1167/7511 clone) | implementation embedded in bytecode (not upgradeable) |
| Beacon contract | the address itself is a beacon: its implementation and owner |
| ProxyAdmin contract | owner, plus the managed proxy and its implementation, traced through the admin's creation transaction (OZ v5 admins, explorer only) |
| Not a proxy | `owner()` if present |

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -s
```

```
Proxy Info: 0x4200000000000000000000000000000000000010

Chain           Chain ID   Proxy type
──────────────────────────────────────────────────
arbitrum        42161      no code at address
avax            43114      no code at address
base            8453       transparent proxy
bsc             56         no code at address
xdai            100        no code at address
linea           59144      no code at address
mainnet         1          no code at address
optimistic      10         transparent proxy
matic           137        no code at address
sepolia         11155111   no code at address
sonic           146        no code at address
unichain        130        transparent proxy
zksync          324        no code at address
robinhood       4663       no code at address
```

`-s, --short` skips owner lookups and the managed-proxy trace, so it is fast enough to scan every chain in the profile at once: the OP Stack bridge above turns up on the three OP chains of the default profile and nowhere else. Drop `-s` once you know which chains matter.

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -c base,optimistic
evm contract proxy-info 0x4200...0010 -c base --full   # extra diagnostics
```

`--full` adds:

- bytecode size; ProxyAdmin `UPGRADE_INTERFACE_VERSION()` (OZ v5 vs v4); ERC-1822 `proxiableUUID()` check for UUPS
- initialization state (OZ v5 ERC-7201 slot, OZ v4 slot-0 heuristic) with a warning for uninitialized proxies
- owner classification: EOA / Gnosis Safe (with `threshold/owners`) / other contract
- `pendingOwner()` (Ownable2Step) and `paused()` (Pausable) when present
- native balance held by the proxy (when non-zero)
- implementation codehash plus a cross-chain comparison that warns when bytecode differs between chains
- verified implementation name, upgrade history (`Upgraded` events) and creation info (deployer, date, transaction)

The last group and the ProxyAdmin trace read from a block explorer rather than the RPC. Sources are tried in order — the chain's own `explorer_api`, then Etherscan, then Blockscout — and the API keys come from the `explorers` section of the profile:

```bash
evm explorer set etherscan '${ETHERSCAN_API_KEY}'   # checks the key before storing it
evm explorer list                                   # what is configured, keys masked
```

With nothing configured, those fields are left out and the run says so once on stderr. See [Explorer commands](docs/explorer-commands.md).

### `transfer-ownership <address> <newOwner>`

Call `transferOwnership(newOwner)` on a single chain. Dry-run by default: shows the current owner and signer, warns if the signer is not the owner, and static-calls the transfer to catch reverts. Add `--exec` to send.

```bash
evm contract transfer-ownership 0xContract... 0xNewOwner... --private-key DEPLOYER_PK -c base
evm contract transfer-ownership 0xContract... 0xNewOwner... --private-key DEPLOYER_PK -c base --exec
```

### `proxy-upgrade <proxy> <newImplementation>`

Upgrade a transparent proxy via `ProxyAdmin.upgradeAndCall` (OZ v4/v5). Takes the **proxy** address — the ProxyAdmin comes from the EIP-1967 admin slot. Dry-run by default: verifies the signer owns the ProxyAdmin, the new implementation has code, and static-calls the upgrade. With `--exec` the implementation slot is re-read afterwards to confirm.

```bash
evm contract proxy-upgrade 0xProxy... 0xNewImpl... --private-key DEPLOYER_PK -c zksync
evm contract proxy-upgrade 0xProxy... 0xNewImpl... --private-key DEPLOYER_PK -c zksync --data 0x8129fc1c --exec
```

`--data` passes calldata to `upgradeAndCall` (e.g. an initializer call); defaults to `0x`.

### `code <address>`

Check deployed bytecode at an address.

```bash
evm contract code 0xD935a2bb926019E0ed6fb31fbD5b1Bbb7c05bf65 -c base,arbitrum
evm contract code 0xD935...bf65 -c base --full   # full bytecode hex
```

## Configuration

Everything the CLI knows about a chain lives in one file, a profile:

| What | Where |
|---|---|
| Chains: RPC URL, HTTP headers, token and explorer metadata, plus explorer API keys | `~/.config/evm-elf/profiles/<name>.yaml` |
| Which profile is used | `-p <name>`, else `$EVM_ELF_PROFILE`, else `evm profile set-default`, else `default` |
| Values referenced as `${VAR}` | `./.env`, then `~/.config/evm-elf/.env` |

A profile is also the chain list: the chains it names are the chains every read fans out across. The `default` profile is created on first use from the one bundled with the package ([config/default-profile.yaml](config/default-profile.yaml)).

### The profile file

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

`chain_id` and `rpc_url` are required per chain. The rest is what an RPC cannot tell you: `symbol` and `coingecko_id` fill the token and USD columns of `wallet balance` (no `coingecko_id`, no price), and `explorer_api` names an explorer for a chain the shared sources do not cover. `${VAR}` is resolved from the environment, which keeps keys out of the file, and `rpc_url` also accepts the `<URL>|<AUTH_KEY>` form as shorthand for the `auth-key` header.

The `explorers` section holds one API key per source, since a single key covers every chain that source supports. Edit it with `evm explorer set`, which checks the key before storing it.

Use several profiles for several projects — a profile doubles as "the chains this project uses":

```bash
evm wallet balance 0x72B4...Be7a -p myproject
```

### Profile commands

```bash
evm profile list                          # what exists, and which one is the default
evm profile create myproject              # a copy of the bundled profile
evm profile create myproject --empty      # no chains, fill it with evm chain set
evm profile clone default backup          # copy an existing one, comments included
evm profile clone ./team-chains.yaml team # a file from a repo becomes a profile
evm profile set-default myproject         # used whenever -p is not given
evm profile remove myproject
```

`set-default` writes the name to `~/.config/evm-elf/profiles/.default`, so it survives across shells; `$EVM_ELF_PROFILE` still wins over it and `-p` wins over both, and `set-default` says so when the variable is set. `evm profile set-default default` goes back to the bundled profile. `remove` refuses to delete the profile currently in use unless you pass `--force`, and clearing it that way also resets the default.

### Chain commands

`evm chain` edits a profile in place, keeping its comments and key order:

```bash
evm chain list                                                   # what is configured
evm chain set base https://base.example/rpc                      # add or update a chain
evm chain set base '${BASE_RPC_URL}' -H 'auth-key:${BASE_KEY}'   # keep the secrets in .env
evm chain set base -H 'auth-key:literal-key'                     # only change the header
evm chain set local http://127.0.0.1:8545 --chain-id 31337 --no-verify
evm chain remove sepolia
```

`set` reads the chain id from the endpoint (`eth_chainId`) instead of guessing, so any chain works and a `--chain-id` that disagrees is an error. `--no-verify` skips the request and then needs `--chain-id`, which is how a chain that is not running yet gets added.

Metadata the entry does not have yet — `symbol`, `coingecko_id`, `explorer_api` — is copied from the bundled profile when the chain id matches, which also covers forks. `--symbol`, `--coingecko-id` and `--explorer-api` override it, and an empty value (`--symbol ''`) clears it. `-H` is repeatable, and `--remove-header <name>` drops one.

`chain list` masks header values, since one may be a literal key; `--reveal` prints them. All three take `-p` to work on another profile, and an edited file is written with owner-only permissions.

### Explorer commands

`evm explorer` manages the block explorer API keys that `contract proxy-info --full` uses. One key covers every chain a source supports, so there is no per-chain setting:

```bash
evm explorer list                                     # what is configured, keys masked
evm explorer set etherscan '${ETHERSCAN_API_KEY}'     # keep the key in .env
evm explorer set blockscout YourBlockscoutKey         # or store it in the profile
evm explorer remove blockscout
```

`set` asks the explorer whether it accepts the key before writing it, the way `chain set` reads the chain id from the endpoint; `--no-verify` skips that, which is what you want when writing a profile for another machine. Sources are tried in order: a chain's own `explorer_api`, then `etherscan`, then `blockscout`. With none configured, the explorer-backed fields are left out and `proxy-info` says so once on stderr.

### Chain selection

1. `-c, --chain` — explicit comma-separated list
2. every chain in the profile

`-xc, --exclude-chain` (mutually exclusive with `-c`) takes the profile's chains and removes the named ones:

```bash
evm contract owner 0xD935...bf65 -xc mainnet,zksync
```

### Private keys

`--private-key` accepts a raw hex key (with or without `0x`) or the **name** of an environment variable, e.g. `--private-key DEPLOYER_PK`. Keys are never logged. The name form keeps the key out of your shell history and pairs with a secret manager:

```bash
export DEPLOYER_PK="$(op read 'op://Deploy Keys/deployer/private key')"
evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base --exec
```

### Environment variables

| Variable | What it does |
|---|---|
| `EVM_ELF_PROFILE` | Profile to use when `-p` is not given; wins over `evm profile set-default` |
| `EVM_ELF_CONFIG_DIR` | Where profiles and the user `.env` live (default: `$XDG_CONFIG_HOME/evm-elf`, else `~/.config/evm-elf`). Export it: it picks the directory a `.env` is read from, so it cannot come from one |
| `ETHERSCAN_API_KEY` | Referenced by the bundled profile as `explorers.etherscan`, not read by the CLI directly. Exporting it without that reference does nothing |
| `EVM_PRICE_SOURCE` | `coingecko` (the default when unset) or `none`; any other value is treated as `none`, see [Prices](#prices) |
| `COINGECKO_API_KEY` | CoinGecko demo key; the public endpoint works without one |

The same environment supplies the `${VAR}` references in a profile, such as RPC URLs and header values. Variables are read from the real environment first, then `./.env`, then `~/.config/evm-elf/.env` — an already-set variable is never overwritten.

### Prices

`wallet balance` values native balances in USD through a pluggable source, selected with `EVM_PRICE_SOURCE`:

| Value | Behaviour |
|---|---|
| `coingecko` (the default when unset) | One batched request to the public CoinGecko `simple/price` endpoint. No API key needed; set `COINGECKO_API_KEY` to use a demo key. |
| `none` | No price lookups at all, the same as passing `--no-usd` everywhere. |
| Anything else | Treated as `none`, with a warning on stderr. Setting the variable means you wanted to control the lookup, so an unrecognised value stops it rather than reaching for the network. |

The lookup is best-effort: a failing, rate-limited or slow source (5s timeout) leaves the USD column empty rather than failing the command. Which coin a chain's native token is comes from the profile (`symbol`, `coingecko_id`), so a chain without those falls back to a lowercase `ether` for the token and reports no price.

## Requirements

- Node.js 22+ (the `engines` field of [package.json](package.json))
- An RPC endpoint per chain. The bundled profile ships the chains' own public endpoints; point the ones you use at your own provider with `evm chain set`.
- An explorer API key for the explorer-backed fields of `proxy-info`, stored with `evm explorer set`. Nothing else needs an API key.

## Development

```bash
npm install
npm run evm -- wallet balance 0x72B4...Be7a   # run from source via tsx
npm run build                                 # tsc -> dist/
npm run typecheck
npm run lint
```

`npm install` also builds, since `prepare` runs `tsc`. Pass CLI arguments after `--`, or npm reads them as its own.

## License

[MIT](LICENSE). Extracted from the `onchain-cli` workspace of `deploy-pad`, a private 1inch repository that is MIT too, so [LICENSE](LICENSE) carries both copyright notices.
