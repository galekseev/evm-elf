# Getting started

[Documentation](README.md) › Getting started

This tutorial takes you from a fresh install to reading a wallet and a contract across 14 chains, pointing one chain at your own RPC endpoint, and planning a transfer without sending it. It takes about ten minutes and costs nothing: every command here is a read or a dry run.

## Before you begin

You need the `evm` command on your `PATH`. If `evm --version` prints nothing, follow [Installation](installation.md) first.

You don't need funds, an API key, or a private key. The last step uses a key you generate locally and never fund.

## Quick start

Three commands, to confirm the tool works end to end:

```bash
evm chain list                                                  # the chains you're about to query
evm wallet balance 0x56E44874F624EbDE6efCc783eFD685f0FBDC6dcF   # that wallet, on all of them
evm contract proxy-info 0x4200000000000000000000000000000000000010 -s
```

The rest of this page explains what each result means and how to narrow it.

## Step 1: See which chains you query

Every command reads its chain list from a profile, so start by looking at yours:

```bash
evm chain list
```

```text
Profile default /Users/you/.config/evm-elf/profiles/default.yaml

Chain           Chain ID   RPC URL                                       Token    Headers
─────────────────────────────────────────────────────────────────────────────────────────
arbitrum        42161      https://arb1.arbitrum.io/rpc                  ETH
avax            43114      https://api.avax.network/ext/bc/C/rpc         AVAX
base            8453       https://mainnet.base.org                      ETH
bsc             56         https://bsc-dataseed.bnbchain.org             BNB
xdai            100        https://rpc.gnosischain.com                   xDAI
linea           59144      https://rpc.linea.build                       ETH
mainnet         1          https://ethereum-rpc.publicnode.com           ETH
optimistic      10         https://mainnet.optimism.io                   ETH
matic           137        https://polygon-bor-rpc.publicnode.com        POL
sepolia         11155111   https://ethereum-sepolia-rpc.publicnode.com   ETH
sonic           146        https://rpc.soniclabs.com                     S
unichain        130        https://mainnet.unichain.org                  ETH
zksync          324        https://mainnet.era.zksync.io                 ETH
robinhood       4663       https://rpc.mainnet.chain.robinhood.com       ETH
```

Those 14 names are what `-c` accepts, and they're the chains every read below fans out across. The RPC URLs are each chain's own public endpoint: fine for a few queries, rate-limited under load. Step 5 replaces one of them.

## Step 2: Read a wallet on every chain

Ask for one address and get every chain at once, with a USD total:

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a
```

```text
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

Three things in that output are worth naming now:

- **The** `Nonce` **column is the pending nonce**, which is how you spot a chain where a deployment stalled.
- **Sepolia shows** `-` **for its value.** Testnet ether has no meaningful price, so the bundled profile gives it no `coingecko_id` and the total leaves it out. See [USD prices](configuration.md#usd-prices).
- **A chain that fails doesn't fail the command.** Its row carries the error in the `Status` column, and the other 13 still print.



## Step 3: Narrow to the chains you care about

Fanning out is the default, not the only mode. Pass `-c` with a comma-separated list to query fewer chains:

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a -c base,mainnet
```

```text
Wallet Balance: 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a

Chain           Chain ID   Balance (Native)          Token    Value (USD)      Nonce      Status
────────────────────────────────────────────────────────────────────────────────────────────────
base            8453       0.008921096499920447      ETH      $16.78           34         OK
mainnet         1          0.080837487973711977      ETH      $152.03          34         OK
────────────────────────────────────────────────────────────────────────────────────────────────
Total                                                         $168.81
```

To go the other way, `-xc` starts from every chain in the profile and removes the ones you name. This queries all 14 except mainnet and zkSync:

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a -xc mainnet,zksync
```

Add `--json` to any command to get the same per-chain data as machine-readable output:

```bash
evm wallet balance 0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a -c base --json
```

```json
[
  {
    "chain": "base",
    "chainId": 8453,
    "address": "0xef3c29bc05a77B266A76f2cEa11d8b8886342e8a",
    "balance": "8921096499920447",
    "balanceEth": "0.008921096499920447",
    "nonce": 34,
    "symbol": "ETH",
    "priceUsd": 1882.12,
    "valueUsd": 16.79057414443027
  }
]
```



## Step 4: Inspect a proxy contract

Contract reads fan out the same way, which turns "where does this address have code, and what is it" into one command. Pass `-s` to skip the owner lookups, so scanning every chain stays fast:

```bash
evm contract proxy-info 0x4200000000000000000000000000000000000010 -s
```

```text
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
unichain        130        no code at address
zksync          324        no code at address
robinhood       4663       no code at address
```

That address is the OP Stack bridge, and it turns up on exactly the three OP chains in the profile. Now drop `-s` on the chain that matters to get the details:

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

The CLI detected the proxy type from its storage slots, then followed the EIP-1967 admin slot to the ProxyAdmin and read that contract's owner. `--full` adds bytecode size, initialization state, owner classification, and more, as [Contract commands](contract-commands.md#evm-contract-proxy-info-address) describes.

## Step 5: Point a chain at your own RPC endpoint

Public endpoints rate-limit a 14-chain fan-out quickly, so replace the ones you use with your provider's URL. Substitute yours for the placeholder below:

```bash
evm chain set base https://base.example/rpc
```

```text
Updated base in /Users/you/.config/evm-elf/profiles/default.yaml
  chain_id     8453
  rpc_url      https://base.example/rpc
  symbol       ETH
  coingecko_id ethereum
```

Before writing anything, the command asks the endpoint for its chain ID with `eth_chainId` rather than guessing from the name. A URL answering for the wrong network is an error instead of a wrong result later, and an unreachable URL, including the `base.example` placeholder above, fails the same way.

If the endpoint needs a key, keep the key in the environment instead of the profile file. Quote the value so your shell doesn't expand it:

```bash
evm chain set base '${BASE_RPC_URL}' -H 'auth-key:${BASE_AUTH_KEY}'
```

The CLI resolves `${BASE_RPC_URL}` and `${BASE_AUTH_KEY}` at run time from your environment, `./.env`, then `~/.config/evm-elf/.env`. See [Reference environment variables from a profile](configuration.md#reference-environment-variables-from-a-profile).

## Step 6: Plan a transaction without sending it

Commands that spend money print a plan and stop. Generate a throwaway wallet to see it:

```bash
evm wallet generate
```

```text
Generated Wallet

Address:     0xBB64491b046524ae02BEfFCE766c7E84Ac1b505C
Mnemonic:    squirrel soccer rural breeze hello … alcohol
Private key: 0xb3ef6878…0fe0be53

Store the mnemonic and private key securely — they are shown only once.
```

The real output prints the 12-word mnemonic and the 32-byte key in full; both are shortened above so this page carries no usable key.

Put the key in an environment variable, then pass the variable's **name** to `--private-key`. The CLI accepts a name in place of a key, which keeps the key itself out of your shell history:

```bash
export SCRATCH_PK=0x…   # the private key printed above, in full
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --value 0.01 --private-key SCRATCH_PK -c base
```

```text
Wallet Send: 0.01 ETH → 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
(plan only — pass --exec to send transactions)

[1/1] base: would send 0.01 ETH

Chain           Chain ID   Value Sent                Status
──────────────────────────────────────────────────────────────────────────────────────────
base            8453       0.01                      will send
```

Nothing was broadcast, and the plan printed even though the new wallet holds nothing: a `--value` dry run computes the amount without reading your balance. A `--all` dry run does read balances and gas prices, so it prints the exact amount each chain would sweep.

`--exec` is the only thing that sends, and it's a separate keystroke on purpose:

```bash
# the same command, plus --exec, would broadcast on base
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --value 0.01 --private-key SCRATCH_PK -c base --exec
```

> [!WARNING]
> `send` fans out like every other command. Without `-c` or `-xc`, `--value 0.01 --exec` sends 0.01 of the native token on **each** of the 14 chains. Read the plan's chain list before adding `--exec`.



## What to do next

You've now used every pattern the CLI is built on: fan out, narrow, dry run, execute. These pages go deeper on each part.

- [Configuration](configuration.md) covers profiles, so a second project gets its own chain list with `-p myproject`.
- [Private keys](private-keys.md) shows how to feed keys from a secret manager instead of an `export`.
- [Wallet commands](wallet-commands.md) and [Contract commands](contract-commands.md) document every option, including `--all` sweeps, nonce bumps, ownership transfers, and proxy upgrades.

