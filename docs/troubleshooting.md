# Troubleshooting

[Documentation](README.md) › Troubleshooting

This page lists the messages the CLI produces, what causes each one, and how to fix it. Errors are grouped by where they come from: the install, the profile, a chain endpoint, a key, or a transaction. The last two sections cover output that looks wrong without being an error at all.

## Read the row, not the exit code

Before chasing a specific message, know where the CLI puts it. A read command that fans out treats a chain failure as data rather than as failure.

`evm contract owner`, `evm wallet balance`, `evm contract proxy-info`, and `evm contract code` report a per-chain problem in that chain's row and still exit `0`:

```text
Chain           Chain ID   Owner
──────────────────────────────────────────────────────────────────────
polygon         0          Not in profile 'default' (evm chain set polygon <rpc-url>)
```

So a script that only checks the exit code sees success. Parse `--json` and look for an `error` key on each object instead. The exit codes each command uses are listed in [Wallet commands](wallet-commands.md#exit-codes), [Contract commands](contract-commands.md#exit-codes), [Profile commands](profile-commands.md#exit-codes), [Chain commands](chain-commands.md#exit-codes), and [Explorer commands](explorer-commands.md#exit-codes).

Two codes are all the CLI uses: `0` when it did what you asked, `1` when it didn't. A run you interrupt is a third case and not an exit code at all. The CLI installs no signal handler, so `Ctrl-C` terminates the process by `SIGINT`, which a shell reports as `130`, and `SIGTERM` becomes `143`. Nothing is left half-written either way — a profile edit goes through a temporary file and a rename, so an interrupted one either happened or didn't.

## Fix installation and first-run errors

These appear before the CLI reads any configuration.

### `evm: command not found`

The global install finished but its binary directory isn't on your `PATH`. Print the prefix npm installs into, which holds the binary in its `bin` subdirectory, and check whether your shell searches it:

```bash
npm prefix -g   # for example /usr/local, so the binary is /usr/local/bin/evm
echo $PATH
```

Add that directory to `PATH` in your shell profile, or run the tool from a checkout instead, as [Installation](installation.md#run-from-a-checkout) describes.

### `Unsupported engine` during install

npm refused the package because the Node.js version is below 22. Check what you're running and upgrade:

```bash
node --version
```

Node 22 is the floor set by the `engines` field of `package.json`. See [Requirements](installation.md#requirements).

### `Could not locate bundled config/default-profile.yaml`

The installed package is incomplete, so the CLI can't find the profile it copies on first use. Reinstall it:

```bash
npm install -g @camoseed/evm-elf
```

## Fix profile errors

Every one of these stops the command, because without a profile there's no chain list.

### `Profile not found: <path>`

The named profile doesn't exist. Which name was used matters, so the message says where the name came from: `('myproject' is the default; change it with: evm profile set-default <name>)` when a pointer chose it, or `('myproject' comes from $EVM_ELF_PROFILE)` when the environment did.

List what exists, then either create the profile or point at one that does:

```bash
evm profile list
evm profile create myproject
evm profile set-default default
```

Only `default` is created on demand. Every other name must exist before a command uses it.

### `Invalid profile <path>: expected a top-level 'chains' mapping`

The YAML file parsed, but its structure is wrong. A profile needs a top-level `chains` key with one entry per chain beneath it. A file that starts straight into chain names, or nests them under a different key, produces this. Compare yours against the example in [The profile file](configuration.md#the-profile-file).

`chains` is the only key a profile must have, not the only one it may have: `explorers` holds the block explorer API keys and is optional. Any other top-level key is ignored rather than rejected, so a misspelled `chains` reads as a missing one.

### `Invalid profile: chain 'base' in <path> has unknown field 'rpc_urls'`

A chain entry contains a field the CLI doesn't recognize, which is almost always a typo in a field name. The parser rejects the file rather than ignoring the field and querying the wrong endpoint. The six valid fields are listed in [Chain fields](configuration.md#chain-fields).

The same check produces `has a non-numeric chain_id` when `chain_id` is quoted or fractional, and `must be a mapping with chain_id and rpc_url` when a chain name has no entry beneath it.

### A YAML syntax error, in the parser's own words

A profile that isn't valid YAML fails before the CLI can check anything about its structure, so what you see is the parser's message rather than one of the `Invalid profile` messages above. It spans several lines, quotes the offending text, and points at a line and column:

```text
Implicit map keys need to be followed by map values at line 2, column 3:

chains: [1, 2
  ^^^^^^^^^^^
```

Unlike every other profile error, it doesn't name the file it came from. The file is whichever profile the command would have used, so print that first:

```bash
evm profile list
```

`evm profile list` is the command to reach for while a profile is broken: it marks that one `error`, prints the parse message beneath its row, and still lists the others. Unclosed brackets and inconsistent indentation account for most of these; compare yours against the example in [The profile file](configuration.md#the-profile-file).

### `EACCES: permission denied, open '<path>'` or `EISDIR: illegal operation on a directory, read`

The profile can't be read at all, so the message is the operating system's. `EACCES` means the file is there but its permissions don't allow reading it — every profile the CLI writes is `0600`, so this usually follows a `chown`, a restore from a backup, or a copy made as another user. `EISDIR` means a directory sits where the file should be.

```bash
ls -l ~/.config/evm-elf/profiles
chmod 600 ~/.config/evm-elf/profiles/myproject.yaml
```

A write command fails the same way and changes nothing, because it reads the profile before editing it.

### `Could not write <path>: permission denied. Nothing written.`

The profile is readable but the directory holding it won't accept a write, so nothing was changed. The message names the profile and the directory rather than the temporary file the write was using, because that file is unlinked before you see the error:

```text
Could not write /home/you/.config/evm-elf/profiles/myproject.yaml: permission denied. Nothing written.
Check the directory: ls -ld /home/you/.config/evm-elf/profiles
```

Usually the directory's owner isn't you, which follows a `sudo` run or a restore from a backup. Fix the ownership rather than loosening the mode — a profile can hold a literal API key:

```bash
sudo chown -R "$(id -un)" ~/.config/evm-elf
```

`evm profile remove` reports the same thing as `Could not remove <path>: permission denied. Nothing removed.` Every command that writes a profile behaves this way: `chain set`, `chain remove`, `explorer set`, `explorer remove`, and all of `evm profile`.

### `'myproject' is the profile in use; pass --force to remove it`

`evm profile remove` refuses to delete the profile that later commands would load. Point the default somewhere else first, or force it through and let the default fall back:

```bash
evm profile set-default default
evm profile remove myproject
```

## Fix chain and RPC errors

These appear in a chain's row during a fan-out, or stop `evm chain set` outright.

### `Not in profile 'default' (evm chain set base <rpc-url>)`

You named a chain with `-c` that this profile doesn't configure. The message includes the command that would add it. Check the spelling against the profile's own names, which are yours to choose and don't have to match any registry:

```bash
evm chain list
```

The bundled profile calls Ethereum `mainnet`, Polygon `matic`, Optimism `optimistic`, and Gnosis `xdai`.

### `Environment variable ARBITRUM_RPC_URL not set`

The chain's `rpc_url` or a header references `${ARBITRUM_RPC_URL}`, and nothing supplies it. The CLI reads the real environment, then `./.env`, then `~/.config/evm-elf/.env`. Set the variable in whichever of those suits:

```bash
export ARBITRUM_RPC_URL=https://arb.example/rpc
```

`evm chain list` shows `(unset)` beside every reference it can't resolve, which finds all of them at once.

### `No RPC URL configured` or `No chain_id set`

The chain exists in the profile but its entry is incomplete, usually after a hand edit. Rewrite the entry, which fills in the missing field and validates the endpoint:

```bash
evm chain set base https://mainnet.base.org
```

### `Could not read the chain id from <url>`

`evm chain set` asks the endpoint for its chain ID with `eth_chainId` and waits 5 seconds. This message means the endpoint refused the connection, timed out, or isn't a JSON-RPC endpoint. The message names the fallback for a node that isn't running yet:

```bash
evm chain set local http://127.0.0.1:8545 --chain-id 31337 --no-verify
```

Otherwise, check the URL, and check whether the endpoint needs a header you haven't set with `-H`.

### `Chain id mismatch: <url> reports 8453, expected 137. Nothing written.`

The endpoint answers for a different network than the `--chain-id` you passed. Nothing is written, which is the point: this catches a copied RPC URL before it silently returns another chain's balances. Fix whichever is wrong, the URL or the ID.

### `Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>`

The `rpc_url` value has more than one `|`. Only two forms are valid, a plain URL or a URL with a single auth key appended. See [RPC URL formats](configuration.md#rpc-url-formats).

## Fix private key errors

Four messages cover every way a key argument can fail.

### `--private-key is neither a hex key nor a set environment variable: DEPLOYER_PK`

The CLI treated the value as a variable name, because it isn't 64 hex characters, and that variable has no value. Either the variable isn't exported, or it's set in a `.env` file the CLI doesn't read from your current directory.

```bash
echo ${DEPLOYER_PK:+set}   # prints "set" only when it has a value
```

See [Supply a key from a secret manager](private-keys.md#supply-a-key-from-a-secret-manager).

### `Private key must be a 32-byte hex string`

The variable exists but its value isn't a key. A trailing newline from a secret manager, a quoted value that kept its quotes, or a mnemonic stored where a key was expected all land here. Private keys are 64 hex characters, with or without the `0x` prefix.

### `Not an address, a private key, or a set environment variable: DEPLOYER_PK`

`evm wallet balance` accepts all three, and its argument matched none of them. It's the same cause as the first message, from the command that takes a wallet rather than a key.

### `Env variable DEPLOYER_PK holds neither an address nor a 32-byte hex private key`

The variable resolved, but its value is neither 40 hex characters (an address) nor 64 (a key). Check for whitespace or a truncated value.

## Fix transaction errors

These come from `evm wallet send` and `evm wallet set-nonce`.

### `skip (balance too low (0.0001 ETH, gas reserve 0.0003 ETH))`

`--all` found a balance that doesn't cover the gas reserve it must hold back, so that chain is skipped rather than attempted. This isn't an error, and the other chains still run. Lower `--fee-buffer` toward `1` if the reserve looks conservative for that chain, or accept that the dust stays where it is.

### `Could not determine gas price`

The endpoint returned neither `maxFeePerGas` nor `gasPrice`, so `--all` can't size its reserve. This usually means a non-standard or misconfigured endpoint. Use `--value` with an explicit amount on that chain, or point it at a different provider.

### `sent 6, nonce 34 (timeout waiting for 40)`

`set-nonce --exec` broadcast its transactions and then polled the confirmed nonce every 2 seconds for 60 seconds without reaching the target. The transactions exist; they haven't been mined yet.

Don't re-run with `--exec`, which would send more transactions on top. Re-run the plan and read the current state instead:

```bash
evm wallet set-nonce 40 --private-key DEPLOYER_PK -c base
```

### Every chain shows an error and the command exits `1`

`send` and `set-nonce` exit `1` only when every selected chain failed, which usually points at one shared cause rather than fourteen: an unreachable provider, a key that doesn't resolve, or a profile pointing somewhere unexpected. Run `evm wallet balance` on the same selection to see whether reads work at all.

## Fix contract and proxy errors

These come from the `evm contract` commands.

### `no code at address`

Nothing is deployed at that address on that chain. For a read command it's a normal result and often the answer you wanted, since it's how `proxy-info -s` shows which chains carry a deployment. For `transfer-ownership` or `proxy-upgrade` it stops the command, and the usual cause is `-c` naming the wrong chain.

### `no owner() function` or `contract has no owner() function`

The address holds code, but the contract doesn't expose `owner()`. It may use a different access-control scheme, such as OpenZeppelin's `AccessControl` with roles, which this CLI doesn't read.

### `static call reverted, not sending: <reason>`

With `--exec`, the CLI simulates the call first and refuses to send one that would revert, so the failure costs no gas. The reason comes from the contract. The most common cause for both write commands is a signer that isn't the owner, which the dry run also flags with `Warning: signer is NOT the current owner`.

Confirm which account you're signing as, then check it against the on-chain owner:

```bash
evm wallet address DEPLOYER_PK
evm contract owner 0x1111111254EEB25477B68fb85Ed929f73A960582 -c base
```

### `EIP-1967 admin slot is empty (not a transparent proxy?)`

`proxy-upgrade` upgrades transparent proxies through their ProxyAdmin, and this address has no admin slot set. Run `evm contract proxy-info <address> -c <chain>` to see what the address is instead. A UUPS proxy upgrades through the proxy itself, not through an admin, so this command doesn't apply to it.

### `admin 0x… is an EOA, not a ProxyAdmin contract (upgrade it directly via the proxy)`

The proxy's admin slot points at an account rather than a ProxyAdmin contract, so there's no `upgradeAndCall` to call. Send the upgrade directly through the proxy from that account.

### `new implementation has no code, not sending`

The address you passed as the new implementation holds no bytecode on that chain. Upgrading to it would brick the proxy, so `--exec` refuses. Deploy the implementation on that chain first, and confirm with `evm contract code <address> -c <chain>`.

## Understand output that isn't an error

Four behaviors surprise people without producing a message.

### The USD column is empty

Three causes, in order of likelihood. The chain has no `coingecko_id` in the profile, which is deliberate for testnets. `EVM_PRICE_SOURCE` is set to `none`. Or the price lookup failed, timed out after 5 seconds, or was rate-limited, in which case pricing is skipped rather than retried.

Pricing is best-effort by design, so a slow source never fails a balance query. See [USD prices](configuration.md#usd-prices).

### `proxy-info --full` shows fewer fields than expected

The implementation name, the upgrade history, the creation transaction, and the ProxyAdmin trace all come from a block explorer, not from the RPC endpoint.

If no source is configured for that chain, the run says so once, on stderr:

```text
Skipped explorer lookups: no API key configured. Add one with: evm explorer set etherscan '${ETHERSCAN_API_KEY}'
```

Do that, and check the result:

```bash
export ETHERSCAN_API_KEY=YourEtherscanKey
evm explorer set etherscan '${ETHERSCAN_API_KEY}'
evm explorer list
```

Exporting the variable alone changes nothing: the CLI reads the key from the profile, and the profile is what references the variable.

When there's no message but fields are still missing, a source is configured and didn't answer. Three causes are worth checking in order:

1. **The chain isn't on that explorer.** Etherscan v2 covers 64 chains and Blockscout 120+, but neither covers everything. zkSync Era, for one, needs the `explorer_api` the bundled profile sets for it.
2. **The key stopped working.** `evm explorer set` checks a key when you store it, so this means it was revoked or ran out of quota since. Re-run `evm explorer set` to see the explorer's own answer.
3. **The contract isn't verified.** An unverified implementation has no name to report, which is an answer rather than a failure.

See [Block explorer access](configuration.md#block-explorer-access) and [Explorer commands](explorer-commands.md).

### A fan-out takes a long time

Chains are queried one after another rather than in parallel, so a 14-chain read takes as long as the sum of its endpoints. Two things help: narrow with `-c` once you know which chains matter, and replace the bundled public endpoints with your own provider, which is both faster and not rate-limited.

### A dry run says `will send` on a wallet holding nothing

A `--value` dry run computes the amount without reading balances, so the plan is about the amount, not about affordability. Use `--all`, which does read balances and gas prices, or check with `evm wallet balance` first.

## Reference: validation errors

These stop the command before it reaches a chain. Each one names what it received, so the fix is usually visible in the message itself.

| Message | Fix |
| --- | --- |
| `Invalid Ethereum address: <value>` | Pass a checksummed 20-byte address. From `owner`, `proxy-info`, and `code`. |
| `Invalid recipient address: <value>` | Same, for the `<to>` argument of `send`. |
| `Invalid contract address: <value>` | Same, for the first argument of `transfer-ownership`. |
| `Invalid new owner address: <value>` | Same, for the second argument of `transfer-ownership`. |
| `Invalid proxy address: <value>` | Same, for the first argument of `proxy-upgrade`. |
| `Invalid implementation address: <value>` | Same, for the second argument of `proxy-upgrade`. |
| `send requires either --value <amount> or --all` | Choose one. They can't be combined. |
| `Invalid --value: <value>` | Use `0.01`, `0.01ether`, or `10000000000000000wei`. |
| `Invalid --fee-buffer: <value> (must be a number >= 1)` | Pass a number of at least `1`, such as `1.5`. |
| `--no-wait has no effect without --exec: a plan sends nothing` | Drop `--no-wait`, or add `--exec` if you meant to broadcast. |
| `Target nonce must be a non-negative integer, got: <value>` | Pass a whole number of `0` or more. A leading `-` is read as an option, so `set-nonce -3` fails as `unknown option '-3'` before reaching this check. |
| `--words must be 12 or 24, got: <value>` | Only those two mnemonic lengths exist. |
| `--short and --full are mutually exclusive` | Choose one detail level. |
| `--full requires exactly one chain (use -c <chain>)` | Narrow to a single chain. |
| `transfer-ownership requires exactly one chain (-c <chain>)` | Pass `-c` with one name, no commas. |
| `proxy-upgrade requires exactly one chain (-c <chain>)` | Same. |
| `Invalid --data: must be a 0x-prefixed hex string, got: <value>` | Pass `0x`-prefixed calldata, or omit it for `0x`. |
| `Invalid --header '<value>': expected <name>:<value>` | Use `-H 'auth-key:secret'`, with one colon separating name from value. |
| `Invalid --chain-id '<value>': expected a positive integer` | Pass a whole number above `0`, or omit it and let the endpoint answer. |
| `--no-verify needs --chain-id, since the chain id cannot be read from the RPC` | Add `--chain-id <id>`, or drop `--no-verify` and let the endpoint answer. |
| `Invalid chain name '<value>'` | Use letters, digits, `.`, `_`, or `-`. |
| `Invalid profile name '<value>'` | Same rule, and the name must start with a letter or digit. Checked for `-p` and `$EVM_ELF_PROFILE` as well as for the `evm profile` commands. |
| `Empty API key for '<name>': …` | Pass a key, or drop the entry with `evm explorer remove <name>`. |
| `key argument is neither a hex key nor a set environment variable: <value>` | The `wallet address` wording of the `--private-key` message above. |
| `No chains selected` | From `wallet send` only: the profile has no chains, or `-xc` excluded all of them. Every other command reports an empty selection as an empty table and exits `0`. |
| `Unknown explorer '<value>': known explorers are etherscan, blockscout` | Only those two sources exist. |
| `<explorer> rejected the key: <reason>` | The explorer refused the key. The reason is its own; fix the key, or pass `--no-verify` to store it regardless. |
| `Could not resolve ${VAR}: the environment variable is not set` | Export the variable, or pass `--no-verify` when writing a profile for another machine. |
| `Invalid profile <path>: unknown explorer '<name>'` | A hand-edited `explorers` section names a source that doesn't exist. |

Three option pairs are rejected by the argument parser rather than by the command, so the wording is the parser's — `option 'x' cannot be used with option 'y'`. `-c` with `-xc`, and `--value` with `--all`, each describe the same thing in two ways. `--fee-buffer` with `--value` is different: the gas reserve it scales exists only for `--all`, so passing it alongside `--value` means one of the two isn't what you wanted.

## Next steps

When the message here doesn't cover it, these are the places the answer usually lives.

- [Configuration](configuration.md) documents the files and variables behind most of these messages.
- [Private keys](private-keys.md) covers key handling in full.
- `evm <group> <command> --help` prints a command's own options and examples.
