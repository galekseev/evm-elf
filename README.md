# evm-elf

Multi-chain EVM wallet and contract CLI, built on ethers v6. Two things shape it:

- **Reads fan out.** Every query hits all known chains at once unless you narrow it with `-c`/`-xc`, so `evm contract proxy-info 0x...` answers "where is this deployed and what is it" in one pass.
- **Writes are dry-run.** Anything that sends a transaction prints a plan, checks the signer, and static-calls first. Nothing leaves your machine until you add `--exec`.

Installs as `evm`:

```bash
npm install -g @camoseed/evm-elf
evm wallet balance 0x72B4736F6e482DB07C4F3d7d3b90A24b2FedBe7a
evm contract proxy-info 0xD935a2bb926019E0ed6fb31fbD5b1Bbb7c05bf65
```

Every command supports `--help`.

## Configuration

| What | Where |
|---|---|
| RPC URL per chain | `<CHAIN>_RPC_URL` env var (e.g. `BASE_RPC_URL`), read from `./.env` then `~/.config/evm-elf/.env` |
| Extra or redefined chains | `~/.config/evm-elf/chains.yaml` |
| Named RPC sets | `~/.config/evm-elf/profiles/<name>.yaml` |

The bundled chain list covers 14 chains (`config/chains.yaml`). A user `chains.yaml` is merged on top, so adding a chain does not require a fork:

```yaml
mychain: 31337
```

A profile names RPC endpoints, and naming a subset of chains also narrows the default chain list — a profile doubles as "the chains this project uses":

```yaml
# ~/.config/evm-elf/profiles/myproject.yaml
chains:
  base: https://base.example/rpc
  arbitrum:
    rpc_url: ${ARBITRUM_RPC_URL}
    chain_id: 42161
```

```bash
evm wallet balance 0x72B4...Be7a -p myproject
```

RPC URLs support the `<URL>|<AUTH_KEY>` form, where the auth key is sent as an `auth-key` HTTP header. `${VAR}` in a profile is resolved from the environment.

### Chain selection

1. `-c, --chain` — explicit comma-separated list
2. `-p, --profile` — the chains the profile names
3. every chain in the chain list

`-xc, --exclude-chain` (mutually exclusive with `-c`) takes the default list from 2 or 3 and removes the named chains:

```bash
evm contract owner 0xD935...bf65 -xc mainnet,zksync
```

### Private keys

`--private-key` accepts a raw hex key (with or without `0x`) or the **name** of an environment variable, e.g. `--private-key DEPLOYER_PK`. Keys are never logged.

## Wallet commands

### `balance <wallet>`

Native balance, USD value and pending nonce across chains, with a total. Accepts an address, a private key, or the name of an env var holding either.

```bash
evm wallet balance 0x72B4736F6e482DB07C4F3d7d3b90A24b2FedBe7a
evm wallet balance 0x72B4...Be7a -c base,arbitrum --json
evm wallet balance 0x72B4...Be7a --no-usd     # skip the price lookup
```

Chains whose native token has no meaningful price (testnets) show `-` and are left out of the total, which is then annotated. See [Prices](#prices).

### `send <to>`

Send the native token. With `--value` it sends the same amount on each selected chain; `--all` sweeps the entire balance minus a gas reserve and requires `--exec`.

```bash
evm wallet send 0x5d0F...95eB --value 0.01 --private-key DEPLOYER_PK -c base
evm wallet send 0x5d0F...95eB --all --private-key DEPLOYER_PK -c bsc,base,arbitrum
evm wallet send 0x5d0F...95eB --all --exec --fee-buffer 1.5 --private-key DEPLOYER_PK -xc mainnet
```

`--value` accepts ether amounts (`0.01`, `0.01ether`) or wei (`10000000000000000wei`). `--fee-buffer` is the gas reserve multiplier for `--all` (default `1.1`). `--no-wait` skips waiting for the receipt.

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
| ProxyAdmin contract | owner, plus the managed proxy and its implementation (traced via the admin's creation tx — works for OZ v5 admins, requires an explorer API: Etherscan v2 or the zksync native API) |
| Not a proxy | `owner()` if present |

```bash
evm contract proxy-info 0xProxy... -c zksync
evm contract proxy-info 0xProxy... -s              # chain + proxy type only
evm contract proxy-info 0xProxy... -c base --full  # extra diagnostics
```

`-s, --short` skips owner lookups and the managed-proxy trace, so it is fast enough to scan every known chain at once.

`--full` adds:

- bytecode size; ProxyAdmin `UPGRADE_INTERFACE_VERSION()` (OZ v5 vs v4); ERC-1822 `proxiableUUID()` check for UUPS
- initialization state (OZ v5 ERC-7201 slot, OZ v4 slot-0 heuristic) with a warning for uninitialized proxies
- owner classification: EOA / Gnosis Safe (with `threshold/owners`) / other contract
- `pendingOwner()` (Ownable2Step) and `paused()` (Pausable) when present
- native balance held by the proxy (when non-zero)
- implementation codehash plus a cross-chain comparison that warns when bytecode differs between chains
- verified implementation name, upgrade history (`Upgraded` events) and creation info (deployer, date, tx), which use the explorer API

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

## Prices

`wallet balance` values native balances in USD through a pluggable source, selected with `EVM_PRICE_SOURCE`:

| Value | Behaviour |
|---|---|
| `coingecko` (default) | One batched request to the public CoinGecko `simple/price` endpoint. No API key needed; set `COINGECKO_API_KEY` to use a demo key. |
| `none` | No price lookups at all, the same as passing `--no-usd` everywhere. |

The lookup is best-effort: a failing, rate-limited or slow source (5s timeout) leaves the USD column empty rather than failing the command. Native token symbols and their CoinGecko ids live in `src/lib/native-token.ts`; a chain missing from that map reports no symbol and no price.

## Development

```bash
yarn install
yarn evm wallet balance 0x72B4...Be7a   # run from source via tsx
yarn build                              # tsc -> dist/
yarn typecheck
yarn lint
```

## Origin

Extracted from the `onchain-cli` workspace of [1inch/deploy-pad](https://github.com/1inch/deploy-pad), which is MIT licensed. The original copyright notice is kept in [LICENSE](LICENSE).
