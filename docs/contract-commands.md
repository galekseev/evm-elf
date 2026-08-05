# Contract commands

[Documentation](README.md) › Contract commands

`evm contract` inspects ownership and proxies for a contract that lives at the same address on several chains, and performs the two write operations that follow from it. This page documents each command's arguments, options, output, and exit code.

The three read commands fan out across your profile. The two write commands act on one chain, so they require `-c` with a single name, and they print a plan unless you pass `--exec`.

| Command | What it does | Chains |
| --- | --- | --- |
| [`owner`](#evm-contract-owner-address) | Reads `owner()` | All selected |
| [`proxy-info`](#evm-contract-proxy-info-address) | Detects the proxy type and follows it to implementation, admin, and owners | All selected |
| [`code`](#evm-contract-code-address) | Reports deployed bytecode size | All selected |
| [`transfer-ownership`](#evm-contract-transfer-ownership-address-newowner) | Calls `transferOwnership(newOwner)` | Exactly one |
| [`proxy-upgrade`](#evm-contract-proxy-upgrade-proxy-newimplementation) | Upgrades a transparent proxy through its ProxyAdmin | Exactly one |

## Options shared by these commands

All five accept `-p` and `--json`. The read commands add the chain selection options described in [Configuration](configuration.md#chain-selection).

| Option | Effect |
| --- | --- |
| `-c, --chain <chains>` | Query only the chains you name. Required, and single-valued, for the two write commands. |
| `-xc, --exclude-chain <chains>` | Query every chain in the profile except these; read commands only |
| `-p, --profile <nameOrPath>` | Use another profile, by name or by path |
| `--json` | Print JSON instead of a table |

## `evm contract owner <address>`

Calls `owner()` at one address on every selected chain, which answers "who controls this deployment, and is it the same account everywhere."

```bash
evm contract owner <address> [-c chains | -xc chains] [-p profile] [--json]
```

```bash
evm contract owner 0x1111111254EEB25477B68fb85Ed929f73A960582 -c base,mainnet
```

```text
Contract Owner: 0x1111111254EEB25477B68fb85Ed929f73A960582

Chain           Chain ID   Owner
──────────────────────────────────────────────────────────────────────
base            8453       0xa4659995DC39d891C1bA9131Aaf5F000E5B57224
mainnet         1          0x5E89f8d81C74E311458277EA1Be3d3247c7cd7D1
```

Where a chain can't answer, the reason takes the place of the owner: `no code at address` when nothing is deployed there, `no owner() function` when the contract isn't `Ownable`, or the RPC error. The other chains still print.

The JSON form returns one object per chain with `chain`, `chainId`, `address`, and either `owner` or `error`.

## `evm contract proxy-info <address>`

Detects what kind of proxy sits at an address, then follows it to whatever matters for that kind: the implementation, the admin, the beacon, and the accounts that own them.

```bash
evm contract proxy-info <address> [-c chains | -xc chains] [-p profile] [-s | --full] [--json]
```

| Option | Effect |
| --- | --- |
| `-s, --short` | Print only the chain and the detected type. Skips owner lookups, so it's fast enough for a full fan-out. |
| `--full` | Add diagnostics: code size, initialization state, owner classification, codehash comparison, and explorer-backed history. Can't be combined with `-s`. |

### What each proxy type reports

Detection reads the EIP-1967 storage slots and the bytecode, so it works without an ABI or a verified source.

| Detected type | Reported |
| --- | --- |
| Transparent proxy (EIP-1967) | Implementation, ProxyAdmin, admin owner, and the proxy's own `owner()` |
| UUPS / ERC-1967 proxy | Implementation and the proxy's own `owner()`, which usually authorizes upgrades |
| Beacon proxy (EIP-1967) | Beacon, beacon owner, `beacon.implementation()`, and the proxy's own `owner()` |
| Minimal proxy (EIP-1167 clone) | The implementation embedded in the bytecode. These aren't upgradeable. |
| Beacon contract | The address is itself a beacon: its implementation and owner |
| ProxyAdmin contract | Its owner, plus the proxy it administers and that proxy's implementation, traced through the admin's creation transaction. The trace needs an explorer, and is the one explorer lookup that doesn't wait for `--full`; `-s` skips it |
| Not a proxy | `owner()`, when the contract has one |

### Scan every chain with `--short`

Start wide. `-s` skips the owner lookups and the managed-proxy trace, which makes a 14-chain scan quick:

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -s
```

```text
Proxy Info: 0x4200000000000000000000000000000000000010

Chain           Chain ID   Proxy type
──────────────────────────────────────────────────
base            8453       transparent proxy
mainnet         1          no code at address
optimistic      10         transparent proxy
unichain        130        transparent proxy
```

### Inspect one chain

Drop `-s` once you know which chains carry the contract:

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -c base
```

```text
Proxy Info: 0x4200000000000000000000000000000000000010

base (chain ID 8453)
  Type:           Transparent proxy (EIP-1967)
  Implementation: 0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010 (contract)
  Proxy admin:    0x4200000000000000000000000000000000000018 (ProxyAdmin contract)
  Admin owner:    0x8cC51c3008b3f03Fe483B28B8Db90e19cF076a6d
  Proxy owner():  n/a
```

A field reads `n/a` when the contract doesn't expose it, which for a transparent proxy is the normal state of `Proxy owner()`. An admin that turns out to be an externally owned account is flagged as `(EOA - upgrades sent directly by this account)`, since that changes who can upgrade and how.

### Add diagnostics with `--full`

`--full` answers the questions that come up during a review rather than a lookup:

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -c base --full
```

```text
Proxy Info: 0x4200000000000000000000000000000000000010

base (chain ID 8453)
  Type:           Transparent proxy (EIP-1967)
  Code size:      2055 B
  Implementation: 0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010 (contract)
  Proxy admin:    0x4200000000000000000000000000000000000018 (ProxyAdmin contract)
  Admin version:  no UPGRADE_INTERFACE_VERSION() (likely OZ v4)
  Admin owner:    0x8cC51c3008b3f03Fe483B28B8Db90e19cF076a6d (EOA)
  Proxy owner():  n/a
  Initialized:    NOT initialized - initialize() is callable by anyone! (or does not use Initializable)
  Balance:        0.001524115198579801 ETH (native funds held by this address)
  Impl codehash:  0xc7c6a5f93f0f9b4ec0850e593ece0f496220613b8bc7c680a4c8fae6d1724a74
```

The extra fields fall into two groups.

Read from the chain, so always available:

- Bytecode size, and the ProxyAdmin's `UPGRADE_INTERFACE_VERSION()`, which distinguishes OpenZeppelin v5 admins from v4.
- The ERC-1822 `proxiableUUID()` check for UUPS proxies, which catches an implementation that isn't upgrade-safe.
- Initialization state, from the OpenZeppelin v5 ERC-7201 slot or a v4 slot-0 heuristic, with a warning when a proxy looks uninitialized.
- Owner classification as an externally owned account, a Gnosis Safe with its `threshold/owners`, or another contract.
- `pendingOwner()` for `Ownable2Step` and `paused()` for `Pausable`, when present.
- Native balance held by the proxy, when it isn't zero. It's named in the chain's own `symbol` from the profile, or a lowercase `ether` when the entry sets none.
- The implementation codehash, plus a cross-chain comparison that reports whether the bytecode is identical everywhere or lists the variants when it isn't.

Read from a block explorer, so present only when one is reachable:

- The verified implementation name.
- Upgrade history, from `Upgraded` events.
- Creation information: the deployer, the date, and the transaction.

> [!NOTE]
> Explorer lookups walk the sources the profile configures: a chain's own `explorer_api`, then Etherscan, then Blockscout, stopping at the first that answers. With none configured, those fields are left out and the run says so once on stderr. Add a key with [`evm explorer set`](explorer-commands.md#evm-explorer-set-explorer-apikey), and see [Block explorer access](configuration.md#block-explorer-access) for the order.

The `Initialized` line deserves a second look before you act on it. On an OpenZeppelin v4 contract the CLI reads storage slot 0, a heuristic that a contract with a different layout can defeat, and the label says which source it used.

## `evm contract code <address>`

Reports whether an address holds bytecode and how much, which is the quickest way to confirm a deployment landed on the chains you expected.

```bash
evm contract code <address> [-c chains | -xc chains] [-p profile] [--full] [--json]
```

| Option | Effect |
| --- | --- |
| `--full` | Print the full bytecode hex after the table. Requires exactly one chain, and prints nothing extra when the address holds no code. |

```bash
evm contract code 0x1111111254EEB25477B68fb85Ed929f73A960582 -c base,sepolia
```

```text
Contract Code: 0x1111111254EEB25477B68fb85Ed929f73A960582

Chain           Chain ID   Code Size    Status
────────────────────────────────────────────────────────────
base            8453       22484 B      deployed
sepolia         11155111   0 B          empty
```

The JSON form adds `codeSize` and `deployed` per chain, and `code` with the hex when you pass `--full` — including `"code": "0x"` for an address holding nothing, which the table view leaves out.

## `evm contract transfer-ownership <address> <newOwner>`

Calls `transferOwnership(newOwner)` on one chain. Dry run by default.

```bash
evm contract transfer-ownership <address> <newOwner> -c <chain> --private-key <key>
                                [-p profile] [--exec] [--json]
```

Both addresses must be valid, and `-c` must name exactly one chain. A comma in `-c` is rejected rather than silently using the first name.

| Option | Effect |
| --- | --- |
| `-c, --chain <chain>` | Required. One chain name. |
| `--private-key <key>` | Required. A hex key or the name of an environment variable holding one. |
| `--exec` | Send the transaction. Without it the command only reports what would happen. |

```bash
evm contract transfer-ownership 0x1111111254EEB25477B68fb85Ed929f73A960582 \
  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --private-key DEPLOYER_PK -c base
```

```text
Transfer Ownership (dry run) on base
  Contract:      0x1111111254EEB25477B68fb85Ed929f73A960582
  Current owner: 0xa4659995DC39d891C1bA9131Aaf5F000E5B57224
  New owner:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Signer:        0xa4659995DC39d891C1bA9131Aaf5F000E5B57224

  Static call succeeded

  Re-run with --exec to send the transaction
```

The dry run does three checks: it confirms the address holds code and has an `owner()`, it compares the signer against the current owner, and it static-calls the transfer so a revert costs nothing.

Signing with the wrong account shows up twice in that output. A `Warning: signer is NOT the current owner` line appears above the static call, and the static call itself reverts, replacing `Static call succeeded` with `Static call reverted:` and the reason the contract gave. The dry run still exits `0` either way, so a script must read the output rather than the exit code.

Adding `--exec` turns the static call into a gate. A transfer that would revert isn't sent, and the command fails with `static call reverted, not sending: …`. After a successful send it waits for the receipt and re-reads `owner()`, so the reported new owner is the on-chain value rather than what you asked for.

## `evm contract proxy-upgrade <proxy> <newImplementation>`

Upgrades a transparent proxy by calling `upgradeAndCall` on its ProxyAdmin, for both OpenZeppelin v4 and v5 admins. Dry run by default.

```bash
evm contract proxy-upgrade <proxy> <newImplementation> -c <chain> --private-key <key>
                           [--data <hex>] [-p profile] [--exec] [--json]
```

The first argument is the **proxy**, not the ProxyAdmin. The CLI reads the EIP-1967 admin slot to find the admin itself, which removes the most common way to point an upgrade at the wrong contract.

| Option | Effect |
| --- | --- |
| `-c, --chain <chain>` | Required. One chain name. |
| `--private-key <key>` | Required. A hex key or the name of an environment variable holding one. |
| `--data <hex>` | Calldata passed to `upgradeAndCall`, such as an initializer. Must be `0x`-prefixed. Default `0x`. |
| `--exec` | Send the transaction. |

```bash
PROXY=0x4200000000000000000000000000000000000010
NEW_IMPLEMENTATION=0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010

evm contract proxy-upgrade $PROXY $NEW_IMPLEMENTATION --private-key DEPLOYER_PK -c zksync

# --data carries an initializer call, here initialize() on the new implementation
evm contract proxy-upgrade $PROXY $NEW_IMPLEMENTATION --private-key DEPLOYER_PK -c zksync --data 0x8129fc1c --exec
```

The dry run prints the proxy, the ProxyAdmin, the admin's owner, the current and new implementations, the calldata, and the signer, then warns about the three conditions that break an upgrade:

- The new implementation has no code at that address.
- The signer isn't the ProxyAdmin's owner.
- The proxy already points at the implementation you named.

It also static-calls the upgrade, so a revert surfaces before you spend gas.

With `--exec`, two of those warnings become refusals: an implementation with no code and a failing static call both stop the command before it sends. Three further conditions are errors in either mode, because they mean the address isn't the kind of proxy this command upgrades: no code at the proxy, an empty EIP-1967 admin slot, or an admin that's an externally owned account rather than a ProxyAdmin contract. The last case is still upgradeable, but not through this command; send the upgrade directly through the proxy instead.

After a successful send the command re-reads the implementation slot and warns if it doesn't match what you asked for.

## Exit codes

The read commands treat a per-chain failure as data, and the write commands treat it as failure. One asymmetry is worth remembering.

| Command | Exits `1` when |
| --- | --- |
| `owner` | The address is invalid. Per-chain failures don't change the exit code. |
| `proxy-info` | The address is invalid, or `-s` and `--full` are combined. |
| `code` | The address is invalid, or `--full` is used with anything other than one chain. |
| `transfer-ownership` | Any validation, setup, or send error. A **dry run whose static call reverts still exits `0`**. |
| `proxy-upgrade` | Same as `transfer-ownership`, including the dry-run exception. |

## Next steps

Two of these commands depend on configuration covered elsewhere, and one page collects their errors.

- [Wallet commands](wallet-commands.md) covers balances, transfers, and nonce management.
- [Explorer commands](explorer-commands.md) covers the API keys that `proxy-info --full` depends on.
- [Configuration](configuration.md#block-explorer-access) explains the order explorer sources are tried.
- [Troubleshooting](troubleshooting.md) lists these commands' errors with causes and fixes.
