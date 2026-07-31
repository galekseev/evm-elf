# Private keys

[Documentation](README.md) › Private keys

This page shows how to give the CLI a signing key without leaving it in your shell history, in a file, or on screen. Five commands sign: `wallet send`, `wallet set-nonce`, `contract transfer-ownership`, `contract proxy-upgrade`, and `wallet address`. Everything else is a read and never asks for a key.

The short version: pass the **name** of an environment variable instead of the key itself.

## Two accepted forms

`--private-key` takes either form below. The CLI decides between them by shape: a value matching 64 hex characters, with or without `0x`, is treated as a key, and anything else is looked up as an environment variable name.

| Form | Example | When to use it |
| --- | --- | --- |
| Variable name | `--private-key DEPLOYER_PK` | Always, unless you have a reason not to |
| Raw hex key | `--private-key 0xac09…ff80` | A local test key on a throwaway network |

A raw key on the command line ends up in your shell history, in the process list while the command runs, and in any terminal recording. The variable name form avoids all three.

## Supply a key from a secret manager

Read the key straight into the environment, then pass the variable's name. The key never touches a file or your history:

```bash
export DEPLOYER_PK="$(aws secretsmanager get-secret-value \
  --secret-id prod/deployer/private-key --query SecretString --output text)"
evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --value 0.01 --private-key DEPLOYER_PK -c base --exec
```

The example uses AWS Secrets Manager, where `--output text` is what keeps the JSON quoting out of the value. Any command that prints a secret to stdout works the same way, including `op read` from the 1Password CLI, `pass` from the Unix password store, `gopass` from its Go successor, and `vault kv get -field` from the HashiCorp Vault CLI.

To keep the variable out of the exported environment of every later command, set it for one command only:

```bash
DEPLOYER_PK="$(aws secretsmanager get-secret-value \
  --secret-id prod/deployer/private-key --query SecretString --output text)" \
  evm wallet send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --value 0.01 --private-key DEPLOYER_PK -c base --exec
```

## Supply a key from a .env file

If a secret manager isn't available, put the key in a `.env` file that the CLI loads for you. Create it in the directory you run from, or in `~/.config/evm-elf/.env` to make it available everywhere:

```bash
# ./.env — the key below is Hardhat's published test account, not a real one
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

```bash
evm wallet balance DEPLOYER_PK -c base
```

Two rules make this safe to live with:

1. The file must not be committed. Add `.env` to `.gitignore` before you write the key.
2. Restrict it to your user: `chmod 600 .env`.

A variable already set in your shell always wins over both `.env` files, so a temporary export can override a stored key without editing anything.

## Check which wallet a key belongs to

Before signing anything, confirm the key derives the address you expect. `wallet address` accepts the same two forms and derives the address locally, with no network request:

```bash
evm wallet address DEPLOYER_PK
# 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

`wallet balance` goes one step further and accepts an address, a key, or a variable name holding either. Passing a key derives the address and queries that:

```bash
evm wallet balance DEPLOYER_PK
```

> [!TIP]
> The dry runs of `set-nonce`, `transfer-ownership`, and `proxy-upgrade` print the signer's address. Read that line before adding `--exec`; it's the cheapest way to catch a variable pointing at last quarter's key. `wallet send` prints only the recipient, so check its signer with `wallet address` beforehand.

## Generate a key for testing

`wallet generate` creates a random wallet locally and prints its mnemonic and private key to stdout:

```bash
evm wallet generate
evm wallet generate --words 24 --json
```

The secrets appear once, on screen, and nothing stores them. Redirect the JSON form straight into your secret manager rather than reading it off the terminal:

```bash
evm wallet generate --json | op document create --title 'deployer key'
```

## What the CLI never does with your key

These guarantees are worth knowing, because they set the boundary of what you still have to protect.

- **Keys are never written to a profile.** Profiles hold RPC URLs, headers, and token metadata; nothing in the format stores a key.
- **Keys are never logged or printed.** Commands print the derived signer address instead, in tables, dry runs, and `--json` output alike.
- **Keys are never sent anywhere but as a signature.** Signing happens locally through ethers; the RPC endpoint receives a signed transaction.

## What still needs care

Three things fall outside those guarantees.

- **`wallet generate` prints secrets by design.** They land in your scrollback and in any terminal log.
- **`chain list --json` prints header values unmasked.** A profile header holding a literal provider key is exposed there, though the table view masks it. See [How files are written](configuration.md#how-files-are-written).
- **`--exec` on a fan-out sends on every chain in the profile.** That isn't a key leak, but it's the mistake that costs the most. Narrow with `-c` and read the plan first.

## Next steps

With a key in place, the commands that use it are worth reading before you run them with `--exec`.

- [Wallet commands](wallet-commands.md) documents the dry run and `--exec` behavior of `send` and `set-nonce`.
- [Contract commands](contract-commands.md) covers the ownership checks that run before `transfer-ownership` and `proxy-upgrade` send anything.
- [Troubleshooting](troubleshooting.md) lists the key resolution errors and what each one means.
