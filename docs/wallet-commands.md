# Wallet commands

[Documentation](README.md) › Wallet commands

`evm wallet` covers balances, native-token transfers, and nonce management. This page documents each command's arguments, options, output, and exit code.

Three of the five commands reach a chain and fan out across your profile. `send` and `set-nonce` sign, so they require `--private-key` and print a plan unless you pass `--exec`. `generate` and `address` are local and make no network request.


| Command                                      | What it does                                               | Signs |
| -------------------------------------------- | ---------------------------------------------------------- | ----- |
| `[balance](#evm-wallet-balance-wallet)`      | Native balance, USD value, and pending nonce across chains | No    |
| `[send](#evm-wallet-send-to)`                | Sends the native token, by fixed amount or full sweep      | Yes   |
| `[set-nonce](#evm-wallet-set-nonce-target)`  | Raises a wallet's nonce to a target                        | Yes   |
| `[generate](#evm-wallet-generate)`           | Creates a random wallet                                    | No    |
| `[address](#evm-wallet-address-private-key)` | Derives the address for a key                              | No    |




## Options shared by the chain commands

`balance`, `send`, and `set-nonce` accept these. [Configuration](configuration.md#chain-selection) explains how the selection resolves.


| Option                          | Effect                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| `-c, --chain <chains>`          | Query only the comma-separated chains you name                             |
| `-xc, --exclude-chain <chains>` | Query every chain in the profile except these; can't be combined with `-c` |
| `-p, --profile <nameOrPath>`    | Use another profile, by name or by path                                    |
| `--json`                        | Print JSON instead of a table                                              |




## `evm wallet balance <wallet>`

Reads the native balance, USD value, and pending nonce for one wallet on every selected chain, then totals the values it could price.

```bash
evm wallet balance <wallet> [-c chains | -xc chains] [-p profile] [--no-usd] [--json]
```

The `<wallet>` argument accepts three things: an address, a 32-byte hex private key, or the name of an environment variable holding either. A key is only used to derive the address locally.


| Option     | Effect                                                            |
| ---------- | ----------------------------------------------------------------- |
| `--no-usd` | Skip the price lookup entirely, dropping the `Value (USD)` column |


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

Four details in the output repay knowing:

- **The** `Nonce` **column is the pending nonce**, which counts transactions in the mempool as well as mined ones.
- `Value (USD)` **shows** `-` when the chain has no `coingecko_id` or the price lookup failed. Those chains stay out of the total, and a closing line names any that hold a balance.
- **Amounts under $0.01 print as** `<$0.01`, so a dust balance isn't rounded to nothing.
- `Status` **carries per-chain errors.** An unreachable endpoint reports itself there while the other chains still print.

The JSON form returns one object per chain, with `symbol`, `priceUsd`, and `valueUsd` present only when they're known, and `error` present only when that chain failed. A failed chain still carries `balance`, `balanceEth`, and `nonce`, all zero — the row is a placeholder, not a reading — so check `error` before you add anything up:

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



## `evm wallet send <to>`

Sends the native token to one address on every selected chain. Prints a plan and stops unless you pass `--exec`.

```bash
evm wallet send <to> (--value <amount> | --all) --private-key <key>
                     [-c chains | -xc chains] [-p profile]
                     [--fee-buffer <multiplier>] [--exec] [--no-wait] [--json]
```

`<to>` must be a valid address, and exactly one of `--value` or `--all` is required.


| Option                      | Effect                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--value <amount>`          | Send this amount on each selected chain. Accepts `0.01`, `0.01ether`, or `10000000000000000wei`.                                    |
| `--all`                     | Sweep the whole balance minus a gas reserve. Can't be combined with `--value`.                                                      |
| `--fee-buffer <multiplier>` | Multiplier on the `--all` gas reserve. Default `1.1`; must be at least `1`. Rejected alongside `--value`, which holds nothing back. |
| `--private-key <key>`       | Required. A hex key or the name of an environment variable holding one.                                                             |
| `--exec`                    | Broadcast. Without it the command only prints its plan.                                                                             |
| `--no-wait`                 | Return once transactions are broadcast, instead of waiting for receipts. Needs `--exec`: a plan broadcasts nothing to wait for.     |


> [!CAUTION]
> `--all --exec` **empties the wallet.** It sweeps the entire native balance of every selected chain, and with no `-c` or `-xc` that is every chain in your profile at once. A broadcast transaction cannot be recalled, cancelled, or refunded by anyone: a mistyped recipient is a permanent loss, and the only confirmation step that exists is the plan you print by leaving `--exec` off.
>
> Run it without `--exec` first. Then check the recipient character by character, check the chain list, and check the amount each chain would sweep. The plan names the recipient but not the signer, so confirm the wallet you're about to empty with `evm wallet address DEPLOYER_PK` before you commit. You do this at your own risk — evm-elf is [MIT-licensed](../LICENSE) software supplied without warranty of any kind, and the author accepts no liability for funds lost through a transaction you signed.

```bash
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --value 0.01 --private-key DEPLOYER_PK -c base
```

```text
Wallet Send: 0.01 ETH → 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
(plan only — pass --exec to send transactions)

[1/1] base: would send 0.01 ETH

Chain           Chain ID   Value Sent                Status
──────────────────────────────────────────────────────────────────────────────────────────
base            8453       0.01                      will send
```

Amounts are named in the chain's own token, taken from its `symbol` in the profile — so the same `--value 0.01` reads as `0.01 BNB` on `bsc` and `0.01 POL` on `matic`. The opening line can only name one token, so it drops the symbol when the selected chains don't agree on one, and a chain whose entry sets no `symbol` gets a bare number. The `Value Sent` column is always a bare number.

The `Status` column reports one of these per chain.


| Status                           | Meaning                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `will send`                      | Dry run. This is what `--exec` would broadcast.                   |
| `sent, block <n>`                | Broadcast and mined in that block.                                |
| `sent (not waiting for receipt)` | Broadcast with `--no-wait`; the transaction may still be pending. |
| `skip (zero balance)`            | `--all` on a chain holding nothing.                               |
| `skip (balance too low (…))`     | `--all` where the balance doesn't cover the gas reserve.          |
| An error message                 | That chain failed. The others still ran.                          |


> [!WARNING]
> Without `-c` or `-xc`, `send` covers every chain in the profile, so `--value 0.01 --exec` sends 0.01 of the native token 14 times over on the bundled profile. The plan lists exactly which chains it would touch; read it before adding `--exec`.



### How `--value` and `--all` differ in a dry run

The two modes do different amounts of work before `--exec`, which is worth knowing when a plan looks too optimistic.

A `--value` dry run computes the amount and stops. It doesn't read your balance, so a plan can say `will send` on a chain that can't afford it.

An `--all` dry run reads the balance, the fee data, and an estimated gas limit on each chain, then prints the exact amount that chain would sweep. The reserve it holds back is `gasLimit × maxFeePerGas × --fee-buffer`.

With `--exec`, `--all` also pins the gas limit and fee parameters to the values it planned with, so the fee can't exceed the reserve. Whatever the reserve doesn't spend stays behind as dust, which is why a swept wallet ends at a small non-zero balance rather than exactly zero. Raise `--fee-buffer` when a chain's gas price is volatile enough that the transaction risks being underpriced.

```bash
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --all --private-key DEPLOYER_PK -c bsc,base,arbitrum
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --all --exec --fee-buffer 1.5 --private-key DEPLOYER_PK -xc mainnet
```

The JSON form returns one object per chain with `chain`, `chainId`, `from`, `to`, `value`, and `valueEth` always present, plus `txHash` and `blockNumber` after a send, `skipped` with the reason, or `error`.

## `evm wallet set-nonce <target>`

Raises a wallet's nonce to a target by sending zero-value transactions to itself, one per missing nonce. Prints a plan and stops unless you pass `--exec`.

```bash
evm wallet set-nonce <target> --private-key <key>
                     [-c chains | -xc chains] [-p profile] [--exec] [--json]
```

`<target>` must be a non-negative integer. A leading `-` is read as an option, so a negative target is rejected by the argument parser rather than by the command.

The command is mainly useful for one job: deploying a contract at the same address on several chains. A `CREATE` address is derived from the deployer address and its nonce and nothing else, so the same deployer sending from the same nonce lands the contract at the same address on every chain.


| Option                | Effect                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| `--private-key <key>` | Required. A hex key or the name of an environment variable holding one.              |
| `--exec`              | Send the transactions. Without it the command only prints how many each chain needs. |


```bash
evm wallet set-nonce 40 --private-key DEPLOYER_PK -c base,mainnet
```

```text
Wallet Set-Nonce: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 → target 40
(plan only — pass --exec to send transactions)

Chain           Chain ID   Current    Txs Needed   Status
──────────────────────────────────────────────────────────────────────
base            8453       34         6            will send
mainnet         1          40         0            skip (already at target)
```

A nonce can never be lowered, so a chain at or above the target is skipped with `skip (already at target)` or `skip (above target)`. Each transaction still costs gas on the chains that do need one, so read the `Txs Needed` column before running with `--exec`.

With `--exec`, the command sends every transaction with an explicit nonce without waiting in between, then polls the confirmed nonce every 2 seconds for up to 60 seconds. If the target isn't confirmed in that window, the status reads `sent <n>, nonce <m> (timeout waiting for <target>)`. The transactions are already broadcast at that point, so re-run the plan to see where the chain landed rather than sending again.

## `evm wallet generate`

Creates a random wallet locally and prints its mnemonic, private key, and address. No network request, and nothing is stored.

```bash
evm wallet generate [--words <12|24>] [--json]
```


| Option            | Effect                                       |
| ----------------- | -------------------------------------------- |
| `--words <count>` | Mnemonic length, `12` or `24`. Default `12`. |


```bash
evm wallet generate --words 24 --json
```

The JSON form returns `address`, `mnemonic`, and `privateKey`, which is the form to pipe into a secret manager. See [Generate a key for testing](private-keys.md#generate-a-key-for-testing).

> [!CAUTION]
> Both the mnemonic and the private key are printed in full, to stdout, once. Anything reading your terminal or scrollback reads them too.



## `evm wallet address <private-key>`

Derives the address for a key, locally and without a network request. Use it to confirm which wallet a variable points at before signing with it.

```bash
evm wallet address <private-key> [--json]
```

The argument accepts a hex key or the name of an environment variable holding one, the same as `--private-key` elsewhere.

```bash
evm wallet address DEPLOYER_PK
# 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

The JSON form returns `{"address": "0x…"}`.

## Exit codes

Every command exits `0` on success and `1` on failure, but what counts as failure differs between reads and writes.


| Command     | Exits `1` when                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `balance`   | The `<wallet>` argument resolves to neither an address, a key, nor a set variable. Per-chain failures don't change the exit code.            |
| `send`      | An argument is invalid, the key can't be resolved, no chains are selected, or **every** chain errored. Skipped chains don't count as errors. |
| `set-nonce` | The target isn't a non-negative integer, the key can't be resolved, or every chain errored.                                                  |
| `generate`  | `--words` is neither `12` nor `24`.                                                                                                          |
| `address`   | The argument is neither a hex key nor a set variable.                                                                                        |


A read command that reaches no chain at all still exits `0`, with the reason in each row. Check the `Status` column rather than the exit code when scripting reads, or parse `--json` and look for `error`.

## Next steps

The other command group works the same way, and two pages cover what these commands depend on.

- [Contract commands](contract-commands.md) covers ownership and proxy inspection with the same fan-out and dry-run behavior.
- [Private keys](private-keys.md) shows how to supply `--private-key` from a secret manager.
- [Troubleshooting](troubleshooting.md) explains the errors these commands report per chain.

