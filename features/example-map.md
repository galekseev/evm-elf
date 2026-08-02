# Example Map: the `evm` command-line interface

Phase 1 of the BDD workflow, and the input to the `.feature` files beside this
file. It is recorded rather than discarded because the interesting output of an
Example Mapping session is not the scenarios — it is the questions.

Source of truth: [the approved requirements
specification](../docs/reverse-engineer/requirements-specification.md), 147
requirements, `REQ-001` – `REQ-147`. **Where the implementation contradicted a
requirement, the rule below states the requirement**, as it stands after the
ruling. Nine such contradictions were found, each recorded as a question and
carried into the features as a `@conflict` scenario. All nine have been ruled on
— six by amending the requirement, three by changing the code — and none is open.

Conventions, following the four-colour Example Mapping convention:

| Card | Here |
| --- | --- |
| Story (yellow) | One of the areas below — eleven mapped in Phase 1, three more added during formulation — each becoming one `.feature` file |
| Rule (blue) | `R<area>.<n>`, carrying the requirement IDs it comes from |
| Example (green) | A concrete instance under its rule, becoming a `Scenario` |
| Question (red) | `Q<n>`, needing a human — no scenario asserts a Question's subject |

---

## 1. Successful command execution → `command-execution.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R1.1 | Five command groups and 21 subcommands exist under the binary `evm` | REQ-001 |
| R1.2 | A command that does what it was asked exits `0` and writes its result to standard output | REQ-005, REQ-006 |
| R1.3 | A read reaches every chain in the profile unless narrowed by `-c` or `-xc` | REQ-068 |
| R1.4 | A command that can sign prints a plan and sends nothing until `--exec` | REQ-090 |
| R1.5 | `chain set` reads the chain ID from the endpoint and inherits metadata by chain ID | REQ-051, REQ-054 |
| R1.6 | Profile lifecycle commands report the absolute path they acted on | REQ-013, REQ-041, REQ-043, REQ-045 |
| R1.7 | The two local-only wallet commands make no network request at all | REQ-101, REQ-102 |
| R1.8 | Each read command has a fixed column set | REQ-047, REQ-060, REQ-080, REQ-104, REQ-114 |

### Examples

- `wallet address DEPLOYER_PK` with the variable exported → the checksummed address, exit `0` (R1.7)
- `wallet generate --words 24` → address, 24-word mnemonic, private key, no request (R1.7)
- `wallet balance <address> -c solo --no-usd` → one row: balance, symbol, nonce, `ok` (R1.8)
- `contract code <address> -c solo` → `Code Size` and `Status: deployed` (R1.8)
- `contract owner <address> -c solo` → `Chain`, `Chain ID`, `Owner` (R1.8)
- `chain set base-backup https://mainnet.base.org` → writes `chain_id: 8453`, and `symbol: ETH` and `coingecko_id: ethereum` that no one typed (R1.5)
- `profile create myproject` → the 14 bundled chains, named in file order (R1.6)
- `profile set-default myproject` → `.default` holds `myproject`; the pointer path is printed (R1.6)
- `wallet send --value 0.01 -c bsc` without `--exec` → `Wallet Send: 0.01 BNB → …`, exit `0`, nothing broadcast (R1.4)
- A bare read on the 14-chain bundled profile → 14 rows; `-c base,mainnet` → 2; `-xc mainnet,zksync` → 12 (R1.3)

---

## 2. Invalid and missing arguments → `arguments.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R2.1 | Three option pairs are rejected by the parser, in the parser's own wording, before any command body runs | REQ-008 |
| R2.2 | A bare profile name matches `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, enforced on every route that names a profile | REQ-024 |
| R2.3 | Key resolution fails with one of exactly four messages, each naming what it received | REQ-076 |
| R2.4 | Each command validates its own arguments with a documented message | REQ-087, REQ-089, REQ-097, REQ-101, REQ-104, REQ-120 |
| R2.5 | Option combinations that cannot both be meant are refused, naming the actual problem | REQ-053, REQ-073, REQ-086, REQ-093, REQ-113, REQ-115 |
| R2.6 | A missing required argument or option is a parser error, never a prompt | REQ-135 |
| R2.7 | A failure prints its message alone on standard error, with no stack trace | REQ-009 |
| R2.8 | Every message that stops a command before it reaches a chain appears in the troubleshooting reference | REQ-133 |

### Examples

- `-c base -xc mainnet` → `error: option '-c, --chains <chains>' cannot be used with option '-xc, --exclude-chains <chains>'` (R2.1)
- `--value 1 --all`, and `--fee-buffer 1.2 --value 1` → the parser's exclusivity message, exit `1`, no side effect (R2.1)
- `chain list -p 'bad name!'` and `EVM_ELF_PROFILE='bad name!' chain list` → the same invalid-name message (R2.2)
- `--private-key NOPE` → `--private-key is neither a hex key nor a set environment variable: NOPE` (R2.3)
- `wallet address NOPE` → the same sentence with `key argument` in place of `--private-key` (R2.3)
- `wallet balance NOPE` → `Not an address, a private key, or a set environment variable: NOPE` (R2.3)
- A variable holding neither → `Env variable <name> holds neither an address nor a 32-byte hex private key` (R2.3)
- `--value abc` → `Invalid --value: abc`; `--fee-buffer 0.5` → `Invalid --fee-buffer: 0.5 (must be a number >= 1)` (R2.4)
- `set-nonce abc` → `Target nonce must be a non-negative integer, got: abc`; `set-nonce -- -3` → the same for `-3`, while `set-nonce -3` → the parser's `error: unknown option '-3'` (R2.4)
- `wallet generate --words 18` → `--words must be 12 or 24, got: 18` (R2.4)
- `contract owner notanaddress` → `Invalid Ethereum address: notanaddress` (R2.4)
- `proxy-upgrade --data deadbeef` → `Invalid --data: must be a 0x-prefixed hex string, got: deadbeef` (R2.4)
- `chain set … --no-verify` with no `--chain-id` → `--no-verify needs --chain-id, since the chain id cannot be read from the RPC` (R2.5)
- `transfer-ownership … -c a,b` → `transfer-ownership requires exactly one chain (-c <chain>)` (R2.5)
- `proxy-info -s --full` → `--short and --full are mutually exclusive` (R2.5)
- `code --full` over two chains → `--full requires exactly one chain (use -c <chain>)` (R2.5)
- `wallet send` with neither `--value` nor `--all` → `send requires either --value <amount> or --all` (R2.5)
- `--no-wait` without `--exec` → `--no-wait has no effect without --exec: a plan sends nothing` (R2.5)
- `-H nocolon` → `Invalid --header 'nocolon': expected <name>:<value>` (R2.4)
- `explorer set etherscn key` → `Unknown explorer 'etherscn': known explorers are etherscan, blockscout` (R2.4)
- `wallet address` with nothing after it → `error: missing required argument 'private-key'`, and no read of standard input (R2.6)
- Any of the above → one line on stderr, no `at …` frames (R2.7)

---

## 3. Help and version output → `help-and-version.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R3.1 | `--version` prints the version from the installed manifest and exits `0` | REQ-002 |
| R3.2 | `--help` is available at the root, at each group, and at each subcommand | REQ-003 |
| R3.3 | Root help additionally prints the resolved profiles directory and the four-source precedence | REQ-003, REQ-010 |
| R3.4 | Root help lists the five groups, alongside the parser's own help entry | REQ-001 |
| R3.5 | Every subcommand's help prints its own options and at least one worked example | REQ-134 |
| R3.6 | Help and version are pure: they read no profile and write nothing | REQ-016, REQ-138 |

### Examples

- `evm --version` → `1.0.0`, exit `0` (R3.1)
- `evm --help` → `wallet`, `contract`, `chain`, `explorer`, `profile`, and the parser's own `help [command]` under `Commands:` (R3.4) — **REQ-001 amended, see Q5**
- `evm --help` → a `Configuration:` block naming the absolute profiles path (R3.3)
- `EVM_ELF_CONFIG_DIR=/tmp/scratch evm --help` → the block names `/tmp/scratch/profiles/<name>.yaml` (R3.3)
- `evm chain set --help` → the options of `chain set` and an example invocation (R3.5)
- All 21 subcommands → each prints an example block (R3.5)
- `evm --help` on an empty configuration directory → the directory stays empty, no seeding (R3.6)

---

## 4. Missing and malformed configuration → `configuration.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R4.1 | `default.yaml` is seeded from the bundled profile whenever the resolved name is `default` and the file is missing, however that name was reached, and the creation is reported on stderr | REQ-015 |
| R4.2 | A missing profile that was not named by `-p` reports where the name came from | REQ-026 |
| R4.3 | The four write commands fail on a missing profile and create nothing | REQ-057 |
| R4.4 | A profile needs a top-level `chains` mapping; any other top-level key is ignored rather than rejected | REQ-028 |
| R4.5 | A chain entry accepts exactly six fields; any other field rejects the whole profile | REQ-029 |
| R4.6 | An entry missing `chain_id` or `rpc_url` is that chain's error, not the profile's | REQ-030 |
| R4.7 | The `explorers` section accepts only `etherscan` and `blockscout` | REQ-032 |
| R4.8 | `profile list` shows an unparseable profile as `error` and still lists the others | REQ-040 |
| R4.9 | A bare name resolves to `<name>.yaml`, falling back to `<name>.yml` | REQ-025 |
| R4.10 | `rpc_url` takes exactly two forms; more than one `\|` is rejected | REQ-018 |

### Examples

- Empty config directory + `chain list` → 14-chain `default.yaml` created, `Created <path> from the bundled default profile` on stderr (R4.1)
- The same for `chain list -p default` and `chain set -p default …`; `-p neverexisted` creates nothing and exits `1` (R4.1)
- `EVM_ELF_PROFILE=myproject`, no such file → `Profile not found: <path> ('myproject' comes from $EVM_ELF_PROFILE)` (R4.2)
- The same name from `.default` → `… ('myproject' is the default; change it with: evm profile set-default <name>)` (R4.2)
- The same name from `-p` → no hint appended (R4.2)
- `rpc_timeout: 30` alongside `chains` → loads without complaint (R4.4)
- Top-level `chainz` → `Invalid profile <path>: expected a top-level 'chains' mapping` (R4.4)
- `rpc_urls` inside an entry → `Invalid profile: chain 'base' in <path> has unknown field 'rpc_urls'` (R4.5)
- `chain_id: "8453"` → `has a non-numeric chain_id`; a bare chain name → `must be a mapping with chain_id and rpc_url` (R4.5)
- One chain without `rpc_url` → that row reads `No RPC URL configured (evm chain set <chain> <rpc-url>)`, the others answer (R4.6)
- `explorers: { etherscn: k }` → `Invalid profile <path>: unknown explorer 'etherscn' (known: etherscan, blockscout)` (R4.7)
- One malformed profile among three → all three listed, the broken one marked `error`, exit `0` (R4.8)
- Only `myproject.yml` present → `-p myproject` reads it; with both, `.yaml` wins (R4.9)
- `https://host/rpc|a|b` → `Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>` (R4.10)

---

## 5. Environment variable precedence → `environment.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R5.1 | `./.env` then `<config dir>/.env` are loaded once per invocation, before parsing, and neither overwrites a variable already in the process environment | REQ-012 |
| R5.2 | `EVM_ELF_CONFIG_DIR` and `XDG_CONFIG_HOME` are read from the process environment only, never from a `.env` file | REQ-011 |
| R5.3 | The configuration directory is `$EVM_ELF_CONFIG_DIR`, else `$XDG_CONFIG_HOME/evm-elf`, else `~/.config/evm-elf` | REQ-010 |
| R5.4 | The profile in use comes from the first of `-p`, `$EVM_ELF_PROFILE`, `.default`, `default` | REQ-022 |
| R5.5 | `profile list` names both the profile in use and which of the four sources chose it | REQ-027 |
| R5.6 | A `.env`-supplied `EVM_ELF_PROFILE` reaches the safety-critical paths: the remove guard and the set-default warning | REQ-044, REQ-045 |
| R5.7 | `${VAR}` in `rpc_url` and header values resolves at run time; unresolved is that chain's error alone | REQ-031 |
| R5.8 | `EVM_PRICE_SOURCE` selects the price source; an unrecognised value selects `none` and warns | REQ-125, REQ-126 |
| R5.9 | A `--private-key` given as a variable name resolves from a `.env` file as readily as from an export | REQ-074 |

### Examples

Precedence, as one table (R5.1, R5.4):

| exported | `./.env` | `<config dir>/.env` | wins |
| --- | --- | --- | --- |
| `alpha` | `beta` | `gamma` | `alpha` |
| — | `beta` | `gamma` | `beta` |
| — | — | `gamma` | `gamma` |

- `-p delta` alongside all three of the above → `delta` (R5.4)
- `EVM_ELF_CONFIG_DIR` in `./.env` and unset in the shell → the default location is used, not the named one; exported, the named one is (R5.2)
- `EVM_ELF_PROFILE=myproject` in `./.env` → `profile list` prints `* in use: myproject (from $EVM_ELF_PROFILE)` (R5.5)
- The other two legends: `(set by evm profile set-default)`, `(built-in default; change it with evm profile set-default <name>)` (R5.5)
- `EVM_ELF_PROFILE=alpha` in `./.env` + `profile remove alpha` → refused with the in-use guard (R5.6)
- `EVM_ELF_PROFILE` set anywhere + `profile set-default beta` → `$EVM_ELF_PROFILE is set to '<value>' and overrides this until unset` (R5.6)
- `ARBITRUM_RPC_URL` unset → the arbitrum row reads `Environment variable ARBITRUM_RPC_URL not set`, other chains answer (R5.7)
- `chain list` → `(unset)` beside every reference it cannot resolve (R5.7)
- `EVM_PRICE_SOURCE=off` → `Warning: unknown price source 'off', using 'none' (valid: coingecko, none)` on stderr, USD column empty (R5.8)
- `EVM_PRICE_SOURCE=none` and `=coingecko` → silent (R5.8)
- `PK=<key>` in `./.env` + `wallet address PK` → the derived address, exit `0` (R5.9)

---

## 6. Current working directory behaviour → `working-directory.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R6.1 | `./.env` is read from the directory the command runs in | REQ-012 |
| R6.2 | A `-p` value containing `/` is a filesystem path, resolved against the working directory | REQ-023 |
| R6.3 | `profile clone` accepts a path as its source, so a chain list committed to a repository becomes a local profile | REQ-043 |
| R6.4 | An absolute configuration directory is the same from every working directory | REQ-010 |
| R6.5 | Every write lands under the configuration directory or the explicit `-p` path, and nowhere else | REQ-016 |
| R6.6 | Nothing outside those two places is created, in the working directory or anywhere else | REQ-138 |

### Examples

- `PK` in `<cwd>/.env`, run from `<cwd>` → resolves; run from a sibling directory → `key argument is neither a hex key nor a set environment variable: PK` (R6.1)
- `-p nested/local.yaml` from the parent, and `-p ./local.yaml` from inside `nested` → the same absolute path in `--json` (R6.2)
- `-p ./out.yaml` + `chain set` → the file beside the caller is edited and the configuration directory stays empty (R6.5)
- `profile clone ./ops/chains.yaml team` → a byte-identical `team.yaml` under the profiles directory (R6.3)
- `chain list -p alpha` from three different working directories → the same resolved path (R6.4)
- `--version`, `chain list`, `profile list`, `profile create`, `chain set`, `wallet generate` → the working directory is untouched by all six (R6.6)

---

## 7. Filesystem failures → `filesystem-failures.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R7.1 | Every profile write goes through a temporary file and a rename | REQ-035 |
| R7.2 | A failed write leaves the target untouched and leaves no temporary file behind | REQ-035, REQ-138 |
| R7.3 | Every file created or rewritten, and the `.default` pointer, ends at mode `0600` | REQ-036 |
| R7.4 | A command that cannot complete refuses rather than half-writes | REQ-042, REQ-043, REQ-052, REQ-057 |
| R7.5 | A missing bundled profile is reported as such | REQ-140 |
| R7.6 | A filesystem failure prints its message alone, with no stack trace | REQ-009 |
| R7.7 | Every message that stops a command appears in the troubleshooting reference | REQ-133 |

### Examples

- Profiles directory made read-only + `chain set` → the profile is byte-unchanged and no temporary file remains (R7.2)
- The seed, `profile create`, `create --empty`, `clone`, `clone --force`, `chain set`, `explorer set`, and `.default` → each target at `-rw-------` (R7.3)
- An operator's own `0644` file, rewritten through `-p` → tightened to `0600` (R7.3)
- `profile create` on an existing name → `Profile already exists: <path>`, file unchanged (R7.4)
- `profile clone a b` where `b` exists → `Profile already exists: <path> (pass --force to overwrite)` (R7.4)
- `profile clone x x` → `Source and target are the same file` (R7.4)
- A directory where a profile file should be → one line, exit `1`, no stack trace (R7.6) — **the message was uncatalogued, see Q13**
- A profile at mode `0000` → one line, exit `1`, no stack trace (R7.6) — **as above**
- A profile containing broken YAML → one line's worth of failure, exit `1` (R7.6) — **as above, see Q12**

---

## 8. Network and external service failures → `external-services.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R8.1 | A per-chain failure is a row, not a command failure — including when every chain failed | REQ-007, REQ-072, REQ-145 |
| R8.2 | A failed chain's JSON object carries `error` alongside zeroed `balance`, `balanceEth`, and `nonce` | REQ-085 |
| R8.3 | The `eth_chainId` check of `chain set` is bounded at 5 seconds and reports the documented failure with its escape hatch | REQ-051, REQ-136 |
| R8.4 | A `--chain-id` that disagrees with the endpoint aborts the write | REQ-052 |
| R8.5 | A price lookup that fails, times out, or is rate-limited leaves the USD column empty and is not retried | REQ-128 |
| R8.6 | When an explorer lookup was wanted and no source remained, one note goes to stderr per run, and none under `-s` | REQ-131 |
| R8.7 | A source that answers with an error is skipped quietly, with no note | REQ-132 |
| R8.8 | Explorer sources are tried in a fixed order, and a source without a usable key is dropped before any request | REQ-129, REQ-130 |
| R8.9 | `explorer set` asks the explorer about the key before storing it, and `--no-verify` is the way past | REQ-062, REQ-063, REQ-064 |
| R8.10 | `wallet send` exits `1` only when every selected chain errored | REQ-096 |
| R8.11 | Every RPC provider carries the chain's configured headers and its pinned chain ID | REQ-017, REQ-018 |
| R8.12 | No outbound request goes anywhere but an RPC endpoint, the price source, or an explorer | REQ-021 |

### Examples

- One unreachable endpoint among three → its `Status` carries the RPC error, the other two print, exit `0` (R8.1)
- Every endpoint unreachable → every row carries its error, exit still `0` (R8.1)
- The failed chain under `--json` → `"balance": "0"`, `"balanceEth": "0"`, `"nonce": 0`, populated `error` (R8.2)
- `chain set` against a socket that never answers → `Could not read the chain id from <url>: no response in 5000ms`, then `Pass --no-verify --chain-id <id> to write the entry anyway.`, exit `1`, nothing written, inside 5–15 s (R8.3)
- `chain set --chain-id 1` against an endpoint reporting 8453 → `Chain id mismatch: <url> reports 8453, expected 1. Nothing written.` (R8.4)
- Price endpoint unreachable → every balance and nonce still prints, USD empty, exit `0` (R8.5)
- `proxy-info --full` with no explorer key → the note once, on stderr, however many chains ran (R8.6)
- `proxy-info -s` with no explorer key → no note (R8.6)
- `explorer set etherscan '${MISSING}'` → `Could not resolve ${MISSING}: the environment variable is not set` + `Pass --no-verify to write the entry anyway.` (R8.9)
- `explorer set etherscan '${MISSING}' --no-verify` → written, output says `key not checked (--no-verify)`, exit `0` (R8.9)
- A chain with `headers` → the stub endpoint sees them on every request (R8.11)
- `rpc_url: https://host/rpc|topsecret` → an `auth-key: topsecret` header (R8.11)
- `wallet send` where one chain of three succeeds → exit `0`; where all three error → exit `1`; where all three skip → exit `0` (R8.10)
- `wallet balance --no-usd` → no price request is issued at all (R8.12, REQ-084)

---

## 9. Idempotency → `idempotency.feature`

The specification states idempotency per command rather than as one rule, so
each example below names the requirement that makes the repeat safe.

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R9.1 | Seeding happens only when `default.yaml` is missing; a second run neither recreates nor overwrites it | REQ-015, REQ-146 |
| R9.2 | The bundled profile is never merged into a live one, so a chain removed stays removed however many reads follow | REQ-014 |
| R9.3 | A creating command run twice fails the second time and leaves the first result untouched | REQ-042, REQ-043 |
| R9.4 | An editing command run twice with the same arguments leaves the same file | REQ-037, REQ-055, REQ-056 |
| R9.5 | A removing command run twice fails the second time, listing what remains | REQ-058, REQ-066 |
| R9.6 | `set-default` run twice with the same name leaves the same pointer and reports no change | REQ-045 |
| R9.7 | A dry run is repeatable and changes nothing, on chain or on disk | REQ-090, REQ-091 |
| R9.8 | `set-nonce` skips a chain already at or above the target, so re-running the plan is safe | REQ-098 |
| R9.9 | After a `set-nonce` timeout the safe operation is the plan, not another `--exec` | REQ-100 |
| R9.10 | `wallet generate` is deliberately not idempotent: a new wallet every run | REQ-101 |
| R9.11 | A rewrite tightens permissions every time, not only on creation | REQ-036 |

### Examples

- `chain list` twice on an empty configuration directory → seeded once; the notice appears once; the second run's file is byte-identical (R9.1)
- Remove `base` from `default.yaml`, then run three reads → `base` does not come back (R9.2)
- `profile create alpha` twice → second exits `1`, file unchanged (R9.3)
- `chain set base <url> --chain-id 8453 --no-verify` twice → the file after the second run is byte-identical to after the first (R9.4)
- `chain remove solo` twice → second → `Chain 'solo' is not in <path> (configured: none)`, exit `1` (R9.5)
- `explorer remove etherscan` twice → second → `Explorer 'etherscan' is not configured in <path> (configured: none)`, exit `1` (R9.5)
- `profile set-default alpha` twice → both print `Default profile is now alpha <path>`; only a genuine change prints `was <previous>` (R9.6)
- `wallet send --value 0.01 -c solo` three times → three identical plans, no transaction, no file written (R9.7)
- `wallet generate` twice → two different addresses (R9.10)
- A `0644` profile rewritten twice → `0600` after each (R9.11)

---

## 10. Interrupted operations → `interruption.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R10.1 | An edit interrupted part-way cannot truncate a working profile | REQ-035 |
| R10.2 | An interrupted run leaves no temporary file and no other state | REQ-035, REQ-138 |
| R10.3 | An interrupted run broadcasts nothing it had not already broadcast | REQ-090 |
| R10.4 | A command abandons an external request at its own bound rather than hanging | REQ-136 |
| R10.5 | `set-nonce --exec` polls at 2-second intervals for at most 60 seconds, then reports the timeout and sends nothing more | REQ-100, REQ-137 |
| R10.6 | Exit codes govern normal termination — `0` on success, `1` on failure; a signal ends the run without one | REQ-005 |

### Examples

- `SIGINT` during a verifying `chain set` → the profile is byte-unchanged, the profiles directory holds only the profile (R10.1, R10.2)
- `SIGTERM` during a fan-out read → nothing on standard output, nothing written (R10.2)
- `SIGINT` during a `--value` dry run → nothing broadcast, which was already true (R10.3)
- A silent endpoint + `chain set` → abandoned at 5 s with the documented message, not hung (R10.4)
- `set-nonce --exec` that never confirms → `sent <n>, nonce <m> (timeout waiting for <target>)` after 60 s, no further transaction (R10.5)
- An interrupted run → terminated by its signal, reporting no exit code at all (R10.6) — **REQ-005 amended, see Q6**

---

## 11. Machine-readable output modes → `json-output.feature`

### Rules

| Rule | Statement | Requirements |
| --- | --- | --- |
| R11.1 | All 21 subcommands accept `--json`, and the output parses | REQ-004 |
| R11.2 | A fan-out command's `--json` is an array with one object per selected chain | REQ-004 |
| R11.3 | Diagnostics go to stderr, so `2>/dev/null` leaves parseable JSON even when the run emits a notice | REQ-006 |
| R11.4 | `--json` carries stored profile values unmasked, where the table masks them | REQ-049 |
| R11.5 | `--json` carries the full value where the table truncates it | REQ-050 |
| R11.6 | A per-chain failure is carried as data in the JSON, because the exit code will not carry it | REQ-007, REQ-085 |
| R11.7 | Named commands carry named keys | REQ-039, REQ-065, REQ-101, REQ-102, REQ-114, REQ-115 |

### Examples

- Each of the 21 subcommands with `--json` → parses, exit code unchanged from the table form (R11.1)
- `wallet balance --json` over three chains → an array of three objects (R11.2)
- `proxy-info --json 2>/dev/null` while the skipped-explorer note fires → still parses (R11.3)
- The same for the first-run seeding notice, the excluded-chain warning, and the unknown price-source warning (R11.3)
- A literal header `supersecretvalue1234` → `****1234` in the table, in full under `--json` (R11.4)
- An `rpc_url` over 45 characters → truncated with `…` in the table, whole under `--json` (R11.5)
- One failed chain among three → its object carries `error` and the zeroed placeholders, exit `0` (R11.6)
- `profile list --json` → `default` and `source`, agreeing with the table's `*` and legend (R11.7)
- `explorer set --json` → `added` and `verified` booleans (R11.7)
- `wallet generate --json` → `address`, `mnemonic`, `privateKey`; `wallet address --json` → `{"address": "0x…"}` (R11.7)
- `contract code --json` on an address with no code → `"code": "0x"`, while the table prints no hex block (R11.7)

---

## Added during formulation

Writing the eleven stories above left 25 behavioural requirements with no
scenario. They are not a twelfth area so much as three subjects the eleven cut
across: what happens to a key, what a contract read reports, and what a write
does before it sends. Each became a feature of its own.

### 12. Signing key handling → `key-handling.feature`

| Rule | Statement | Requirements |
| --- | --- | --- |
| R12.1 | No profile field holds a private key, and a hand-added one rejects the profile | REQ-034, REQ-029 |
| R12.2 | Keys are never written to a file | REQ-077 |
| R12.3 | Keys are never printed, except by the command whose purpose is printing one | REQ-078 |
| R12.4 | Signing happens in this process, and only the signature leaves it | REQ-079, REQ-144 |
| R12.5 | A key argument is resolved by shape, then by lookup | REQ-074, REQ-075 |
| R12.6 | A profile may hold a secret that is not a key, and the table masks it | REQ-048 |
| R12.7 | There is no prompt, so the plan is the only confirmation step | REQ-135 |

Examples: a `private_key` field rejects the profile · `wallet generate` stores
nothing · a send names the signer by address and never by key · `--reveal`
reveals a literal and not a reference · piping `yes` into a sweep changes
nothing.

### 13. Contract inspection → `contract-inspection.feature`

| Rule | Statement | Requirements |
| --- | --- | --- |
| R13.1 | Seven cases are detected from storage slots and bytecode, with no ABI | REQ-105 |
| R13.2 | Each type reports the fields relevant to it; an absent field reads `n/a` | REQ-106 |
| R13.3 | An admin holding no code is flagged as an externally owned account | REQ-107 |
| R13.4 | The short form skips owner lookups and the ProxyAdmin trace | REQ-108 |
| R13.5 | `--full` adds seven diagnostics read from the chain | REQ-109 |
| R13.6 | `--full` reports the implementation codehash and compares it across chains | REQ-110 |
| R13.7 | `--full` adds three fields read from a block explorer | REQ-111 |
| R13.8 | The ProxyAdmin trace runs without `--full`, and is skipped only by `-s` | REQ-112 |
| R13.9 | A read exits `1` only on an invalid address or option combination | REQ-124 |

Examples: the seven short labels · `n/a` for a transparent proxy's own
`owner()` · `(EOA - upgrades sent directly by this account)` · the `(OZ v4
layout, heuristic)` label · a single-chain run has nothing to compare (OQ-3).

### 14. Signing operations → `signing-operations.feature`

| Rule | Statement | Requirements |
| --- | --- | --- |
| R14.1 | `wallet send` reports one of six per-chain outcomes | REQ-095 |
| R14.2 | A sweep pins the gas parameters it planned with | REQ-092 |
| R14.3 | `set-nonce` sends one transaction per missing nonce | REQ-099 |
| R14.4 | The `transfer-ownership` dry run performs three checks | REQ-116 |
| R14.5 | A reverting dry run still exits `0` | REQ-118 |
| R14.6 | `--exec` refuses a reverting transfer, and confirms a successful one by re-reading | REQ-117 |
| R14.7 | `proxy-upgrade` takes the proxy and finds the admin itself | REQ-119 |
| R14.8 | The `proxy-upgrade` dry run warns about three conditions and continues | REQ-121 |
| R14.9 | `--exec` refuses two of those three; not owning the admin is not one of them | REQ-122 |
| R14.10 | Three conditions fail `proxy-upgrade` in either mode | REQ-123 |
| R14.11 | A write exits `1` on any validation, setup, or send error | REQ-124, REQ-103 |

Examples: `Txs Needed: 6` for a chain at 34 with target 40 · `Warning: signer is
NOT the current owner` · `static call reverted, not sending: <reason>` ·
`new implementation has no code, not sending` · `admin <address> is an EOA, not
a ProxyAdmin contract (upgrade it directly via the proxy)`.

---

## Questions

Red cards. No scenario asserts an answer to any of these. Q1 – Q4 are the
specification's own open questions, carried forward verbatim; Q5 – Q13 are
places where the current implementation contradicts an approved requirement,
found by the characterization suite in `test/characterization/`; Q14 – Q16 are
gaps this mapping exposed.

### Carried from the specification

| # | Question | Affects |
| --- | --- | --- |
| Q1 | Should the README's shared-options block qualify `--exec` the way it qualifies `--private-key`? | OQ-1, REQ-090 |
| Q2 | Who owns the explorer chain-coverage figures, and how would anyone notice when they stop being true? | OQ-2, nothing normative |
| Q3 | Is the two-chain precondition on the cross-chain codehash comparison intended, or should a single-chain run report something? | OQ-3, REQ-110 |
| Q4 | Should chain-identity enforcement become this project's own guarantee rather than ethers'? | OQ-4, REQ-017 |

### Implementation contradicts an approved requirement

Nine were found. Six were ruled on and are closed; the scenario now states the
amended requirement and no longer carries `@conflict`.

| # | Requirement said | Implementation does | Ruling, 2026-08-01 |
| --- | --- | --- | --- |
| Q5 | REQ-001: root help lists the five groups "and no others" | The parser's own `help [command]` is listed as a sixth entry | **Closed.** Code is the source of truth. REQ-001's acceptance now allows the parser's built-in; the normative five-groups statement is unchanged |
| Q6 | REQ-005: exit `0` or `1`, no other code | A signal terminates the process, so there is no exit code at all | **Closed.** Code is the source of truth. REQ-005 now scopes itself to normal termination and states that no signal handler is installed |
| Q9 | REQ-037: `chain set` preserves comments | A trailing comment on a field the command rewrites is dropped | **Closed.** Comments on a rewritten value are not persistent. REQ-037 now says so as a prohibition, and the docs say where to put a comment so it survives |
| Q10 | REQ-037: key order is preserved | Clearing a field and setting it again appends it at the end of the entry | **Closed.** Field order carries no meaning. REQ-037 now states the exception |
| Q12 | REQ-133: every message that stops a command is catalogued | A YAML syntax error surfaces the parser's own multi-line message, naming no file | **Closed.** Catalogued as its own section of the troubleshooting reference, including how to find which profile it came from |
| Q13 | REQ-133, as above | A filesystem error surfaces as the raw Node error string | **Closed.** Catalogued as its own section, with the commands that inspect and repair permissions |

The remaining three were ruled on the same day, in the requirements' favour
rather than the code's, and the code changed to match. No `@conflict` scenario
is open.

| # | Requirement says | Implementation did | Ruling, 2026-08-01 |
| --- | --- | --- | --- |
| Q7 | REQ-006: diagnostics and warnings on stderr | `profile list` printed its missing-default warning on stdout, inside the table | **Closed.** The warning moved to stderr; the legend stayed on stdout, because REQ-027 makes it part of the answer. [Elaboration](#q7-the-missing-default-warning-on-stdout) |
| Q8 | REQ-024: the name pattern is enforced on every route, and REQ-023 gives the path form to `-p` alone | A slash in `$EVM_ELF_PROFILE` or in `.default` read a file outside the profiles directory | **Closed.** The path form now belongs to `-p` and to the source of `profile clone`; every other route validates the name. [Elaboration](#q8-a-path-reaching-the-cli-by-a-route-that-should-not-carry-one) |
| Q11 | REQ-037: comments are preserved | `explorer set` inserted its section above a file's opening comment | **Closed.** `profile create --empty` gained a blank line, so the file the CLI writes behaves like the bundled one; REQ-037 now states the rule a blank line decides. [Elaboration](#q11-explorer-set-inserting-its-section-above-the-opening-comment) |

### Exposed by this mapping

| # | Question | Status |
| --- | --- | --- |
| Q14 | No requirement states what happens when the profiles directory is not writable. REQ-035 promises the target survives, and says nothing about the message | **Closed 2026-08-01.** The message named the atomic write's temporary file, which is unlinked before anyone reads it. REQ-147 now requires the profile and the directory instead |
| Q15 | Idempotency is nowhere stated as a system rule — it is a property each command happens to have. Should there be one requirement saying so? | **Accepted as is.** `idempotency.feature` names the per-command requirement behind every repeat, and says so at the top |
| Q16 | Forty-seven scenarios cannot be exercised without a live chain, explorer key, or broadcast (§4.2 of the specification lists the requirements). They are tagged `@code-only` | **Answered, and overtaken.** What the answer said, in Phase 1: nineteen — every proxy branch and most of the explorer group — are reached by a local Etherscan-dialect stub and storage-slot fixtures on the existing RPC stub, neither needing a key; both REQ-062 scenarios resist it, going through `evm explorer set`, whose probe is built against the named source's hardcoded base URL, as does REQ-129, which asserts an order that cannot be seen while the source it is compared against is unreachable; and the remaining broadcast paths stay tagged. REQ-017's provider pin lost the tag shortly afterwards, on the same grounds: the pin is observable as a chain-id request that never reaches the stub. Where the answer was wrong was that remainder. It counted every tag on the four write commands as a broadcast path, and nine of them broadcast nothing — the two contract commands' dry runs, their warnings, and the refusals that stop `--exec` — all nine of which have since been characterized as well. This card is the question and the answer it was given, not a running total: [`README.md`](README.md#tags) states what is tagged now, and `npm run check:features` counts it on every run |

---

## Elaborations on the three conflicts the code changed to settle

Each was reproduced against a `tsc` build of the sources as they stood on
2026-08-01, and each was fixed the same day. What follows is the record: the
finding, the evidence it rested on, and the change that closed it. Code the fix
replaced is quoted as it was, and marked.

### Q7: the missing-default warning on stdout

**What was found.** `evm profile list` closes with one of two lines. When the
profile in use exists, it prints the legend REQ-027 requires — `* in use:
myproject (from $EVM_ELF_PROFILE)`. When it does not, it prints a yellow warning
instead. Both went to standard output, from what was then
`src/commands/profile/list.ts:96-100`. Observed with one profile present and
`EVM_ELF_PROFILE=ghost`:

```text
$ evm profile list 2>/dev/null
   Profile              Chains   Path
──────────────────────────────────────────────────────────────
   alpha                0        …/config/profiles/alpha.yaml

Default profile 'ghost' is missing: …/config/profiles/ghost.yaml

$ evm profile list 2>&1 >/dev/null
                                        # nothing: stderr is empty
```

**Why it was a conflict and not a nuisance.** REQ-006 puts results on stdout and
diagnostics, warnings and errors on stderr, and its rationale is that `--json`
must stay parseable when piped. That rationale was not violated — the `--json`
branch returns at line 64 and prints neither line. What was violated is the
requirement itself, and the cost was smaller but real: an operator who piped
`evm profile list` into `grep` or a pager got a warning mixed into the table,
and could not separate the two with a redirect.

**The distinction that decided the fix.** The two lines are different kinds of
output. The legend is a *result* — REQ-027 and REQ-039 make reporting the profile
in use part of what this command is for, and `--json` carries the same answer in
its `default` and `source` keys. The missing-default line is a *diagnostic*: it
reports a problem with the machine's state, it is the only yellow line the
command prints, and no JSON key corresponds to it.

**What was changed.** The warning moved and the legend stayed — one line,
`console.log` to `console.error`, now at `src/commands/profile/list.ts:102`:

```ts
// The legend is part of the answer; this is a diagnostic about the machine's
// state, so it goes to stderr and leaves the table redirectable on its own.
console.error(chalk.yellow(`Default profile '${active.name}' is missing: ${target.path}`));
```

`evm profile list 2>/dev/null` is now the table and the legend, and
`2>&1 >/dev/null` is the warning, which is what REQ-006 promises everywhere else.

**What was decided alongside it.** The `--json` form is silent about this state.
A script can infer it — `default` names a profile that no entry in `profiles`
matches — but nothing says so. The options were to leave it or to add a boolean
alongside `default` and `source`. It was left, and REQ-039 stands: the two
existing keys already carry the answer, and adding a third would need its own
requirement.

### Q8: a path reaching the CLI by a route that should not carry one

**What was found.** `resolveProfilePath`, in `src/lib/chains.ts`, decided
path-or-name before it validated anything — the code as it was:

```ts
if (nameOrPath.includes('/') || isAbsolute(nameOrPath)) {
  return resolve(process.cwd(), nameOrPath);
}
assertProfileName(nameOrPath);
```

Every route reaches this function. When `-p` is absent, the name comes from
`defaultProfileName()`, which returns `$EVM_ELF_PROFILE` or the raw contents of
the `.default` pointer, neither of them validated. So a value containing a slash
was a path however it arrived. Observed before the fix:

```text
$ EVM_ELF_PROFILE=/tmp/outside/secret.yaml evm chain list
Profile /tmp/outside/secret.yaml /tmp/outside/secret.yaml
ghost           1          http://127.0.0.1:1

$ evm profile set-default /tmp/outside/secret.yaml
Invalid profile name '/tmp/outside/secret.yaml': use letters, digits, '.', '_' or '-'
```

**Why the ordering was there.** It was deliberate. Verification-report finding U2
added the `assertProfileName` call and records the reason for putting it second:
"after the path branch has returned, so a path is still a path". The fix was
right about `-p` and overreached in its claim to cover "every way a profile gets
named", which is the sentence REQ-024 was written from.

**How bad it was.** Not a privilege-escalation route. Appendix A1 of the
specification already treats the operator's environment as trusted, and the
`.default` pointer could only hold a path if hand-edited, because `set-default`
rejects one. The real cost was the asymmetry above: the same string was a working
profile reference through one route and an invalid name through another, and a
mistyped variable produced a path-shaped failure rather than the documented
invalid-name message. `assertProfileName`'s own comment states the intent the
code then sidestepped — "a path-like argument would write to or delete a file
anywhere".

**What was changed.** The path form now belongs to the two arguments an operator
types a path into. `resolveProfilePath` gained a parameter for whether a path is
acceptable, defaulting to no (`src/lib/chains.ts:36-50`):

```ts
export function resolveProfilePath(nameOrPath: string, allowPath = false): string {
  if (allowPath && (nameOrPath.includes('/') || isAbsolute(nameOrPath))) {
    return resolve(process.cwd(), nameOrPath);
  }
  assertProfileName(nameOrPath);
  …
}
```

`resolveProfileTarget` already knew the answer, because `nameOrPath` is defined
exactly when `-p` supplied it, and passes `nameOrPath !== undefined`
(`src/lib/chains.ts:161`). `profile clone` passes `true` for its source, which is
what keeps a chain list committed to a repository usable (REQ-043), and validates
its target as a name. Every other route now validates:
`EVM_ELF_PROFILE=/tmp/outside/secret.yaml` fails with the same message
`set-default` always gave, and all four routes agree.

**The alternative, and why it was not taken.** The path form could have been
allowed for `-p` and `$EVM_ELF_PROFILE` — both supplied per invocation or per
shell — and refused for the pointer, which `set-default` validates on the way in.
That would keep `export EVM_ELF_PROFILE=./ops/chains.yaml` working. It costs
consistency: `profile list` would have to show a profile outside the profiles
directory, and REQ-023 and REQ-024 would both need amending rather than one being
enforced. It is the fix to revisit if that export turns out to be someone's
workflow.

### Q11: `explorer set` inserting its section above the opening comment

**What was found.** `explorersMap` (`src/lib/profile-file.ts:143-161`) creates a
missing `explorers` section by unshifting it to the front of the document, for
the reason its comment gives: the section is two lines and a reader should not
scroll past fourteen chains to find it. That is still what it does — the fix was
to the file the CLI writes, not to the insertion.

**What was actually wrong was narrower than it first looked.** The `yaml` library
attaches a comment to a node, and which node depends on a blank line:

| The file opens with | The comment attaches to | After `explorer set` |
| --- | --- | --- |
| A comment flush against `chains:` | The `chains` key | It travels down with `chains`; `explorers` is now the first line |
| A comment, then a blank line, then `chains:` | The document | It stays at the top; `explorers` goes beneath it |

So the same edit does two different things to two files that differ by one blank
line — and the operator has no reason to know that blank line is significant.

**It reached a file the CLI wrote itself.** `EMPTY_PROFILE`
(`src/lib/profiles.ts:23`), which `evm profile create --empty` writes, held its
comment flush against `chains:`. Observed before the fix:

```text
$ evm profile create scratch --empty && evm explorer set etherscan k --no-verify -p scratch
explorers:
  etherscan: k
# evm-elf profile. Add chains with: evm chain set <chain> <rpc-url>
chains: {}
```

The bundled profile was never affected, because it already ships an `explorers`
section, so the insertion path never runs on a stock `default.yaml`.

**The fix, and why it was not the obvious one.** The obvious fix — carrying
`commentBefore` from the old first key onto the new `explorers` pair — keeps the
file opening with the operator's comment, and was rejected. A comment flush
against `chains:` is, under the YAML model and under most people's habits, a
comment *about* `chains`; moving it onto `explorers` makes `# chains follow`
introduce the explorers section. That trades a whitespace-dependent surprise for
a comment that is wrong.

What was done instead is one line of data and one paragraph of prose.
`EMPTY_PROFILE` now carries a blank line between its header and `chains:`, so the
file the CLI generates behaves the way the bundled one does:

```ts
const EMPTY_PROFILE = `# evm-elf profile. Add chains with: evm chain set <chain> <rpc-url>\n\nchains: {}\n`;
```

REQ-037 states the rule the blank line decides — a comment separated from the
following key by a blank line is a file header and stays at the top; a comment
flush against a key belongs to that key and moves with it — and
`docs/configuration.md` says so beside the two exceptions already recorded there.

That leaves the behaviour as it is, which is defensible, and removes the only
case where the CLI's own output triggered the surprise.
