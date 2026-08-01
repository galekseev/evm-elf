# Verification Report: evm-elf user documentation vs. implementation

Date: 2026-08-01 (third revision, after two rounds of fixes)
Score: **99/100 — PASS** (first run: 89, second: 92)

Intended behaviour: `README.md`, `docs/*.md`.
Observed behaviour: `index.ts`, `src/**`, and the runtime output of `node dist/index.js`.

`dist/` was confirmed byte-identical to a fresh `tsc` build of `src/` on every run, so its
runtime output is evidence about the current sources rather than about a stale build.

A note on citations. Every finding but the four ambiguous ones is now resolved, so most
documentation line numbers here are historical: they point at the revision the finding was
raised against, which is the text the finding is about. The four open items carry current
numbers. Source citations are current throughout, and every citation quotes enough of the claim
to find it if a line has moved.

## Revisions

Three rounds. Nothing is deleted between them, because a record of what was wrong is worth as
much as a record of what is wrong now.

**First run.** 8 conflicts, 3 drifts, 7 undocumented behaviours, 2 unimplemented ones, 4
ambiguous claims. Score 89.

**Second round.** Six conflicts closed, two in code (C3, C4) and four in documentation
(C2, C5, C6, C7). C1 and C8 were held back for a closer look, which made C8 worse: the same
cause silently disables the guard that stops `evm profile remove` deleting the profile in use,
and skips the override warning in `evm profile set-default`. Two claims that had passed moved
out of the Match column, so the score rose to 92 rather than to 95.

**Third round.** Everything else closed. C1 and C8 in code, and writing that fix turned up a
fourth C8 symptom worse than the other three: `evm chain remove` was editing a different
profile from the one every read used. D1, D2, D3, U1, X2, X3, X4 and X7 in documentation; U2,
X1, X5 and X6 in code. Score 99.

**Fourth round.** The two Markdown rendering defects, which are not scored because they are not
claims about behaviour. Scanning for the pattern rather than fixing the two reported instances
turned up a third, in the strongest warning on the page. See
[Documentation defects](#documentation-defects-unrelated-to-behaviour-resolved).

## Summary

152 verifiable claims checked.

| Classification | Now | Second round | First run | Meaning |
| --- | --- | --- | --- | --- |
| Match | 148 | 132 | 128 | Code and runtime do what the docs say |
| Direct conflict | 0 | 4 | 8 | Documented behaviour and observed behaviour contradict each other |
| Documentation drift | 0 | 3 | 3 | Behaviour has moved past the description |
| Undocumented behaviour | 0 | 7 | 7 | Real behaviour the docs never mention |
| Unimplemented documented behaviour | 0 | 2 | 2 | Described behaviour absent from the code |
| Ambiguous requirement | 4 | 4 | 4 | Claim cannot be settled against the code as written |

Scored as `(148 + 4 × 0.75) / 152`, the ambiguous items counting three quarters each. The four
are the only findings left: A1 and A3 have concrete fixes available and were not part of either
fix round, while A2 and A4 are claims about the outside world that no amount of reading this
codebase can settle.

The documentation was already unusually accurate about the things it is mostly made of — every
command's arguments, options, table layout, per-chain error strings, validation messages and
exit codes were reproduced verbatim on the first run. What the three rounds changed sits almost
entirely in two areas: when the environment is read, and how files are written.

### Method and coverage

Claims were checked against code, and against runtime output wherever a run could reach the
behaviour. Runs used an isolated `EVM_ELF_CONFIG_DIR`, hand-written profiles for the parser
paths, `127.0.0.1:9` for unreachable-endpoint paths, and Hardhat's published test key.

The sandbox permits no arbitrary outbound network, so nothing that needs a live public RPC
endpoint, CoinGecko, or a block explorer was reached that way. The third round added a stub
JSON-RPC endpoint on `127.0.0.1` — about thirty lines answering `eth_getBalance`,
`eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt`, `eth_estimateGas`, `eth_gasPrice`
and `eth_getBlockByNumber` — which brought the `wallet balance` and `proxy-info --full` output,
the `--all` gas-reserve path, and the price-source selection within reach. What is left needs a
real chain or a real explorer, and is flagged **code-only** where it appears below. Nothing that
was found and fixed depended on it.

## Resolved conflicts: the `.env` loading defect

Both were the same defect seen from two sides, so the mechanism is described once, under C1,
and the fix that closed both is at the end of C8.

### The mechanism behind C1 and C8

Loading `.env` is opt-in per command. `loadEnv()` (`src/lib/env.ts:93-100`) runs dotenv over
`./.env` and then `<config dir>/.env`, guarded by an `envLoaded` flag so that calling it twice
is free:

```ts
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  dotenvConfig({ path: resolve(process.cwd(), '.env') });
  dotenvConfig({ path: resolve(USER_CONFIG_DIR, '.env') });
}
```

Nothing called it centrally. Each command handler called it as its first statement, and 13 of
the 21 did. The eight that did not were `wallet address`, `wallet generate`, `chain remove`,
and the five `profile` subcommands. Everything downstream reads `process.env` directly —
dotenv's only effect is to populate that object — so a variable that existed solely in a `.env`
file was visible to a command that called `loadEnv()` and invisible to one that did not. There
was no type, no wrapper and no test marking a handler as environment-dependent; the call was a
convention, and three commands that needed it were missing it.

`wallet generate` reads no environment at all, so its omission cost nothing. The other seven
are C1 and C8.

### C1. `wallet address` cannot read a key from `.env`

`docs/private-keys.md:42-53` presents a `.env` file as a supported way to supply a key,
`docs/private-keys.md:64-68` says `wallet address` "accepts the same two forms" as
`--private-key` elsewhere, and `docs/troubleshooting.md:147-155` explains the resulting
failure as the variable being "set in a `.env` file the CLI doesn't read from your current
directory". `wallet address` reads neither `.env` file.

Evidence: `src/commands/wallet/address.ts:10-17` has no `loadEnv()`; contrast
`src/commands/wallet/balance.ts:58`, `send.ts:33`, `set-nonce.ts:21`. Key resolution then
turns on `process.env` alone — `resolvePrivateKey` (`src/lib/wallet.ts:19-34`) tests the
argument against `/^(0x)?[0-9a-fA-F]{64}$/` and, failing that, looks up
`process.env[flagValue]` — so the lookup sees only what the shell exported.

Observed, with `DEPLOYER_PK` set in `./.env` and nowhere else:

```text
$ evm wallet balance DEPLOYER_PK -c base
Wallet Balance: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266            # exit 0
$ evm wallet address DEPLOYER_PK
key argument is neither a hex key nor a set environment variable: DEPLOYER_PK   # exit 1
$ DEPLOYER_PK=0xac09…ff80 evm wallet address DEPLOYER_PK              # exported instead
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266                            # exit 0
```

**Why it is worth more than one line of code.** The blast radius is a single argument of a
single command, and that command cannot spend anything, which is why it survived. But it is
the command the documentation puts in the way of everything that can:

> The dry runs of `set-nonce`, `transfer-ownership`, and `proxy-upgrade` print the signer's
> address. … `wallet send` prints only the recipient, so check its signer with
> `wallet address` beforehand. — `docs/private-keys.md:78`

So the reader who follows `docs/private-keys.md` end to end — store the key in `.env`, confirm
which wallet it is, then sweep — has the middle step fail. Three things then push the
diagnosis away from the real cause:

1. The failure names the variable, so it reads as "your variable is wrong" rather than "this
   command doesn't read `.env`".
2. The check the docs offer for that diagnosis, `echo ${DEPLOYER_PK:+set}`
   (`docs/troubleshooting.md:152`), prints nothing for a `.env`-only variable — appearing to
   confirm the wrong answer.
3. The obvious way past it is to paste the raw key on the command line, which is the one thing
   the page exists to prevent (`docs/private-keys.md:18`).

A reader can also reasonably conclude that `wallet balance` and `wallet address` disagree
about what a variable name means, when in fact they agree and differ only in whether a file
was read.

Confidence: High. **Resolved in code** — see the fix at the end of C8, which closed both.

### C8. Four commands could not see `EVM_ELF_PROFILE` in a `.env` file

None of the five `profile` subcommands called `loadEnv()`, and neither did `chain remove`.
`resolveDefaultProfile()` (`src/lib/env.ts:67-80`) checks `process.env.EVM_ELF_PROFILE` first,
then the `.default` pointer file, then the built-in name. With the variable in a `.env` file the
first branch was skipped, so these commands answered from the pointer while every command that
called `loadEnv()` answered from the variable. Four documented behaviours broke, in rising order
of cost. The fourth was found while writing the fix; the first three were the second round's
finding.

**1. `profile list` names the wrong profile, and the wrong reason.** This is the one the docs
single out as the fix for precisely this confusion:

> When a command reports a profile you didn't expect, `evm profile list` prints which one is in
> use and where the choice came from. — `docs/configuration.md:44-45`

Evidence: `src/commands/profile/list.ts:36-39`. Observed, with `EVM_ELF_PROFILE=myproject` in
`./.env` and `.default` pointing at `default`:

```text
$ evm chain list
Profile myproject /tmp/evm-v4/cfg/profiles/myproject.yaml
$ evm profile list
* in use: default (built-in default; change it with evm profile set-default <name>)
```

Both halves of the closing line are wrong, and `--json` repeats them as
`"default": "default", "source": "pointer"`, so a script reading it is wrong too. The `*`
marker agrees with the legend — `resolveProfileTarget()` on the same line derives it from the
same function — so the command is internally consistent and externally wrong, which is the
hardest shape to notice.

**2. `profile set-default` drops its override warning.** `docs/profile-commands.md:128` says
"When that variable is set, the command warns that the pointer it wrote won't take effect."
It warns only when the variable was exported (`src/commands/profile/set-default.ts:34,46-50`):

```text
$ evm profile set-default default                          # variable in ./.env
Default profile is now default …/profiles/default.yaml
$ EVM_ELF_PROFILE=myproject evm profile set-default default # variable exported
Default profile is now default …/profiles/default.yaml
  was myproject
  $EVM_ELF_PROFILE is set to 'myproject' and overrides this until unset
```

The reader is left believing a pointer took effect that `EVM_ELF_PROFILE` still overrides —
which sends them back to `profile list`, where symptom 1 confirms the mistake.

**3. `profile remove` deletes the profile in use without its guard.** This is the one that
loses work. `src/commands/profile/remove.ts:29-34` decides whether a profile is in use with the
same blind `resolveDefaultProfile()`, so with the variable in `.env` the refusal never fires:

```text
$ evm profile remove myproject               # variable in ./.env; myproject IS in use
Removed profile myproject …/profiles/myproject.yaml                     # exit 0
$ evm chain list
Profile not found: …/profiles/myproject.yaml ('myproject' comes from $EVM_ELF_PROFILE)

$ EVM_ELF_PROFILE=myproject evm profile remove myproject   # exported instead
'myproject' is the profile in use; pass --force to remove it, or point elsewhere first
with evm profile set-default <name>                                     # exit 1
```

`docs/profile-commands.md:102` states the guard's purpose exactly — "Removing the profile in
use is refused, because the next command would fail with a missing-profile error" — and that
is the observed outcome. The CLI even names `$EVM_ELF_PROFILE` in the failure it caused,
because `loadProfile` runs after `loadEnv()`: it learns about the variable one command too
late. A profile is a hand-tuned list of endpoints, headers and keys, and there is no
confirmation prompt and no undo.

**4. `chain remove` edited a different profile from the one every read used.** Found while
writing the fix, and the worst of the four: nothing here is a diagnostic or a guard, it is an
edit landing in the wrong file. `chainRemoveCommand` reaches `resolveProfileTarget()` →
`defaultProfileName()` with the same blind resolution (`src/commands/chain/remove.ts:20`).

```text
$ evm chain list                      # EVM_ELF_PROFILE=myproject in ./.env
Profile myproject …/profiles/myproject.yaml
$ evm chain remove sepolia
Removed sepolia from …/profiles/default.yaml          # a profile nothing else was using
```

It printed the path, so it was discoverable by a careful reader — but the profile the user was
working in kept `sepolia`, and an unrelated one silently lost it. `chain set` was not affected
only because it happens to call `loadEnv()`, which is the whole problem with a convention.

**Why the shape of this matters.** A project `.env` naming the project's profile is the setup
the docs encourage — `docs/configuration.md:171-176` shows a `.env` holding exactly this kind of
value, and `-p` on every command is the alternative it exists to avoid. Under that setup the CLI
split in two: 13 commands used one profile and 6 used another. Three of the affected behaviours
were a diagnostic or a guard, so the failure mode was not an error message but misplaced
confidence; the fourth wrote to the wrong file.

Confidence: High.

**Resolved in code, for C1 and C8 together.** `loadEnv()` is now called once in `index.ts`
before `program.parseAsync()`, and the 13 per-command call sites are gone
(`index.ts:18-24`). Reading two `.env` paths on every invocation, `--help` included, costs
nothing — dotenv on a missing file is a no-op — and the configuration paths are resolved before
it either way, so C2 is unchanged. The alternative was adding the call to the four handlers that
needed it, which would have left the next handler free to forget it: the defect was never that
one function omitted a call, it was that omitting one was possible and silent.

Verified with the variable in `./.env` and nowhere else: `wallet address DEPLOYER_PK` derives
the address, `profile list` reports `* in use: myproject (from $EVM_ELF_PROFILE)`,
`chain remove sepolia` edits `myproject.yaml`, `profile remove myproject` refuses, and
`profile set-default default` prints the override warning.

One thing this does not fix, by design: `profile remove`'s guard is still the only destructive
operation in the CLI whose safety rests on the environment being loaded, and nothing enforces
that. It is the first test worth writing.

## Resolved conflicts: documentation and file handling

Fixed after the first run. Kept for the record, each with what the fix was and how it was
confirmed.

### C2. `EVM_ELF_CONFIG_DIR` and `XDG_CONFIG_HOME` are not read from `.env`

`docs/configuration.md:150-158` introduces its environment table with "The CLI reads these
from the environment, then `./.env`, then `~/.config/evm-elf/.env`", and the table includes
`EVM_ELF_CONFIG_DIR` and `XDG_CONFIG_HOME`. Both are resolved at module-evaluation time,
before any command body runs and therefore before `loadEnv()` — and the path of the user
`.env` is itself derived from the result, so the dependency is circular and cannot be made
to work by reordering alone.

Evidence: `src/lib/env.ts:41-48` (`CONFIG_HOME`, `USER_CONFIG_DIR`, `PROFILES_DIR` as
module constants) against `src/lib/env.ts:93-100` (`loadEnv`, called from command bodies).
Observed with `EVM_ELF_CONFIG_DIR=/tmp/evm-elf-verify/alt` in `./.env` and unset in the
shell — the run resolved profiles under the default location instead:

```text
Profile not found: /Users/camoseed/.config/evm-elf/profiles/snapshot.yaml
```

`EVM_ELF_PROFILE` from the same `.env` did take effect, which makes the failure look
selective rather than systematic.

Confidence: High.

**Resolved in the documentation**, since the circularity cannot be fixed in code: the location
these variables choose is where one of the `.env` files lives. `docs/configuration.md` now
carries a `Read from` column marking `EVM_ELF_CONFIG_DIR` and `XDG_CONFIG_HOME` as
"Environment only", with the reason and a one-command `VAR=… evm …` example, and the
`Where configuration lives` paragraph says the same. The `README.md` row says to export it.

### C3. Profiles created by copying the bundled profile are world-readable

`docs/configuration.md:229` states "New profile files and the `.default` pointer are created
with owner-only permissions, `0600`, because a profile can hold a literal API key". Only two
of the four creation paths do that. The three that copy a file inherit the source's mode,
and the bundled profile is `0644` (`config/default-profile.yaml`).

| Path | Code | Mode |
| --- | --- | --- |
| First-run seed of `default.yaml` | `src/lib/profiles.ts:51-62` (`copyFile`) | `0644` |
| `evm profile create` | `src/lib/profiles.ts:77` (`copyFile`) | `0644` |
| `evm profile clone` | `src/lib/profiles.ts:97` (`copyFile`) | `0644` |
| `evm profile create --empty` | `src/lib/profiles.ts:74` (`mode: 0o600`) | `0600` |
| `.default` pointer | `src/lib/profiles.ts:120` (`mode: 0o600`) | `0600` |

Observed:

```text
-rw-------@  .default
-rw-------@  blank.yaml        # profile create --empty
-rw-r--r--@  copied.yaml       # profile create
-rw-r--r--@  default.yaml      # first run
-rw-r--r--@  snapshot.yaml     # profile clone
```

The related claim in `docs/chain-commands.md:13` ("An edited file is rewritten atomically
with owner-only permissions") is correct: `writeProfileDocument`
(`src/lib/profile-file.ts:187-198`) writes the temporary file `0600` and renames it over the
target, so `chain set` on a `0644` profile tightens it to `0600`. Verified.

Confidence: High.

**Resolved in code.** `src/lib/profiles.ts` gained an `OWNER_ONLY` constant and a `chmod` after
each of the three `copyFile` calls, which is what `copyFile` needs since it carries the
source's mode across. Re-verified on a fresh config directory — first run, `profile create`,
`profile create --empty`, `profile clone` and `profile clone --force` over an existing file all
produce `-rw-------`, and the `.default` pointer and edited profiles are unchanged at `0600`.

### C4. `chain set` and `explorer set` create a profile that does not exist

`docs/configuration.md:23` states "The CLI creates `default.yaml` on first use, and only that
one. Any other profile must exist before a command names it." The read commands honour this,
and so do `chain remove` (`src/commands/chain/remove.ts:21-24`) and `explorer remove`
(`src/commands/explorer/remove.ts:34-36`), which check for the file. The two `set` commands do
not: `readProfileDocument` starts a fresh document when the path is missing
(`src/lib/profile-file.ts:23-26`) and the write then creates the file.

Evidence: `src/commands/chain/set.ts:76-77` and `:159`; `src/commands/explorer/set.ts:49-50`
and `:69`. Observed:

```text
$ evm chain list -p neverexisted
Profile not found: /tmp/evm-elf-verify/cfg/profiles/neverexisted.yaml    # exit 1
$ evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p neverexisted
Added base to /tmp/evm-elf-verify/cfg/profiles/neverexisted.yaml          # exit 0
```

The same holds for a path: `-p ./local-file.yaml` created that file. Practical effect — a
typo in `-p` on a write command silently forks a new one-chain profile instead of failing,
and the next read against the intended profile shows the edit missing.

Confidence: High.

**Resolved in code.** Both `set` commands now check for the file straight after
`resolveProfileTarget` and fail with `Profile not found: <path>` — the same message
`loadProfile` and the two `remove` commands already produce, so no new message enters the
reference in `docs/troubleshooting.md`. `readProfileDocument`'s comment now records that
callers must check first, since its empty-document fallback is what made the write possible.

One knock-on had to be handled. Seeding the default profile was conditional on `-p` being
absent (`nameOrPath === undefined`), so an explicit `-p default` on a fresh machine reached a
file that did not exist — harmless while the `set` commands created one, but with the check in
place `chain set -p default` would have failed on a fresh machine, and `chain list -p default`
already did. `resolveProfileTarget` now seeds whenever the resolved name is `default`, however
it was reached, which is what `docs/configuration.md:23` describes. Verified: on a fresh config
directory `chain set -p default` and `chain list -p default` both seed the 14-chain bundled
profile and succeed, while `-p neverexisted`, `-p alsonew` and `-p ./arbitrary.yaml` all exit
`1` and create nothing.

The new failure is documented: the exit-code tables in `docs/chain-commands.md` and
`docs/explorer-commands.md` list it, and both `set` sections explain that only `default` is
created on demand.

### C5. `wallet address` is listed as a command that signs

`docs/private-keys.md:5` reads "Five commands sign: `wallet send`, `wallet set-nonce`,
`contract transfer-ownership`, `contract proxy-upgrade`, and `wallet address`." Four commands
sign. `wallet address` derives an address locally and makes no network request, which
`docs/wallet-commands.md:7`, `docs/wallet-commands.md:227` and `docs/private-keys.md:64` all
state correctly, so the page contradicts itself.

Evidence: `src/commands/wallet/address.ts:10-25` — `deriveAddress` only; no provider, no
`sendTransaction`. Confidence: High.

**Resolved in the documentation.** The sentence now reads "Four commands sign", lists the four,
and names the two that take a key without signing — `wallet address` and `wallet balance` —
saying both work locally. That distinction was missing rather than merely miscounted: the page
had no category for a command that reads a key but signs nothing.

### C6. "A profile must have exactly one top-level key"

`docs/troubleshooting.md:74` states "A profile must have exactly one top-level key, `chains`".
`docs/configuration.md:49` says the opposite and is right: "A profile is YAML with two
top-level keys." Beyond that, an unrecognised top-level key is silently ignored rather than
rejected — which is the reverse of the chain-field behaviour the same troubleshooting entry
describes approvingly at `docs/troubleshooting.md:78`.

Evidence: `src/lib/chains.ts:124-137` reads only `chains` and `explorers` and validates
neither the set nor the absence of other keys. Observed — a profile with `rpc_timeout: 30`
alongside `chains` loaded without complaint, while `chainz:` in place of `chains:` failed:

```text
$ evm chain list -p t-extra-top      # rpc_timeout: 30 present
base            8453       https://mainnet.base.org        # exit 0
$ evm chain list -p t-unknown-top
Invalid profile …/t-unknown-top.yaml: expected a top-level 'chains' mapping   # exit 1
```

Confidence: High.

**Resolved in the documentation.** The intent was that the `chains` key is what must be there,
not that it must be alone. `docs/troubleshooting.md` now says a profile needs a top-level
`chains` key, and adds that `chains` is the only key it must have rather than the only one it
may have, `explorers` being the optional second. The observed leniency is recorded in the same
place — any other top-level key is ignored rather than rejected, so a misspelled `chains` reads
as a missing one, which is exactly the error this entry explains.

### C7. "The bundled profile is … never read again"

`docs/configuration.md:19` describes `config/default-profile.yaml` as "copied to `default.yaml`
on first use and never read again". It is read on every `evm chain set`, to fill in `symbol`,
`coingecko_id` and `explorer_api` by matching chain id — which is the behaviour
`docs/chain-commands.md:84` and `README.md:345` document as a feature — and again by
`evm profile create`.

Evidence: `src/commands/chain/set.ts:135` → `src/lib/chains.ts:191-197`;
`src/lib/profiles.ts:77`. Observed: `chain set base-backup <url>` wrote `symbol: ETH` and
`coingecko_id: ethereum` that were given on no command line.

Confidence: High.

**Resolved in the documentation.** The intent behind "never read again" was that the bundled
file is a source of default configuration and never part of the live configuration — nothing
merges it into your profile at run time, and no read or fan-out consults it. Its three reads all
fall on the other side of that line: they are the times a default is wanted. The
`Where configuration lives` row now says so and names them (the first-run copy,
`evm profile create`, and the metadata `evm chain set` fills in by chain ID), and
`The profile file` section adds what the reader was really being told — your profile is the only
chain list any command reads, so a chain you remove stays removed and a chain added to the
bundle in a later release does not appear until you ask for it.

## Documentation drift (resolved)

### D1. The ProxyAdmin trace is not a `--full` feature

`docs/contract-commands.md:156-161` lists "The ProxyAdmin trace from an admin address to the
proxy it manages" under the `--full` heading, among fields "Read from a block explorer", and
`docs/configuration.md:198` likewise names it as one of the "`evm contract proxy-info --full`
fields". The trace runs in the default mode too; it is suppressed only by `-s`. `README.md:183`
has this right, placing it in the plain proxy-type table.

Evidence: `src/commands/contract/proxy-info.ts:366-377` — `findManagedProxy` sits inside
`if (!light)`, not `if (full)`. Consequence: `proxy-info <proxyAdmin> -c <chain>` without
`--full` performs an explorer lookup, and with no key configured emits the "Skipped explorer
lookups" note that `docs/configuration.md:224-232` associates with `--full`.

Confidence: Medium (code-only; needs an explorer key and network to exercise).

**Resolved in the documentation.** The trace is no longer listed among the `--full`
explorer-backed fields in `docs/contract-commands.md`; it is described where it belongs, in the
`ProxyAdmin contract` row of the proxy-type table, as the one explorer lookup that doesn't wait
for `--full` and that `-s` skips. `docs/configuration.md` now opens its explorer section by
saying `proxy-info` is the only command that uses an explorer, that three of its `--full` fields
come from one, and that the trace is a fourth lookup on different terms.

### D2. A negative `--target` never reaches the documented message

`docs/troubleshooting.md:287` documents `Target nonce must be a non-negative integer, got: <value>`
with the fix "Pass a whole number of `0` or more". The message exists
(`src/commands/wallet/set-nonce.ts:24-27`) and fires for `abc` and `1.5`, but a negative value
is intercepted by the option parser first:

```text
$ evm wallet set-nonce -3 --private-key … -c base
error: unknown option '-3'         # exit 1
$ evm wallet set-nonce 1.5 --private-key … -c base
Target nonce must be a non-negative integer, got: 1.5
```

The documented cause and the observed message for the most likely bad input do not line up.
Confidence: High.

**Resolved in the documentation.** Both places that describe the argument now say a leading `-`
is read as an option, so a negative target is rejected by the parser rather than by the command:
the validation-error row in `docs/troubleshooting.md` and the `<target>` sentence in
`docs/wallet-commands.md`. Worth recording for whoever reads this next — the documented message
is reachable for a negative number, but only past the parser: `set-nonce -- -3` prints
`Target nonce must be a non-negative integer, got: -3`.

### D3. `--reveal` does not reveal a `${VAR}` reference

`docs/chain-commands.md:25` and `docs/explorer-commands.md:27` describe `--reveal` as printing
values "instead of masking them", and `docs/chain-commands.md:40` narrows this to "`--reveal`
prints literals in full". A reference is printed as written in both modes, so `--reveal` shows
the reference rather than the value it resolves to — reasonable, and what the narrower sentence
implies, but not what the option descriptions in `--help` say.

Evidence: `src/lib/mask.ts:13-22` returns early for a reference before consulting `reveal`.
Observed: `auth-key: ${BASE_KEY} (unset), literal-key: supersecretvalue1234` under `--reveal`.
Confidence: High.

**Resolved in the documentation, including `--help`.** The option tables in
`docs/chain-commands.md` and `docs/explorer-commands.md` now read "Print literal header values
in full. A `${VAR}` reference is shown as written either way", and the prose adds why: the
reference is not the secret. The two `--help` strings in `src/cli/chain.ts` and
`src/cli/explorer.ts` were the same imprecision in a second place, so they carry the same
wording — a text change with no behavioural effect, but leaving `--help` wrong would have left
half the finding open.

## Unimplemented documented behaviour (resolved)

### U1. `No chains selected` is a `send`-only guard

`docs/troubleshooting.md:297` lists `No chains selected` in its validation-error reference with
the cause "The profile has no chains, or `-xc` excluded all of them", scoped to no particular
command. Only `send` implements it. `set-nonce` — the other signing command that fans out —
prints an empty plan and exits `0`.

Evidence: `src/commands/wallet/send.ts:71-74` against `src/commands/wallet/set-nonce.ts:39-41`.
Observed on a chainless profile:

```text
$ evm wallet send 0xf39F… --value 0.01 --private-key … -p nochains
No chains selected                                              # exit 1
$ evm wallet set-nonce 5 --private-key … -p nochains
Chain           Chain ID   Current    Txs Needed   Status       # exit 0, no rows
```

`docs/wallet-commands.md:250-251` is narrower and correct, listing the condition for `send`
only, so the two pages disagree. Confidence: High.

**Resolved in the documentation**, matching the narrower page rather than adding the guard: the
row now reads "From `wallet send` only … Every other command reports an empty selection as an
empty table and exits `0`." A `set-nonce` run against a chainless profile does no work and says
so in an empty plan, which is a defensible outcome for a command whose whole job is per-chain.

### U2. The `-p` name rule is not enforced

`docs/configuration.md:42` states "A bare name must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` and
resolves to `<name>.yaml` in the profiles directory". The resolution half is implemented,
including the `.yml` fallback; the validation half is not. `assertProfileName`
(`src/lib/profiles.ts:22-26`) is called only from the `evm profile` subcommands, and
`resolveProfilePath` (`src/lib/chains.ts:28-41`) validates nothing.

Observed:

```text
$ evm chain list -p 'bad name!'
Profile not found: /tmp/evm-elf-verify/cfg/profiles/bad name!.yaml     # exit 1
$ evm profile create 'bad name!'
Invalid profile name 'bad name!': use letters, digits, '.', '_' or '-' # exit 1
```

Low impact — an invalid `-p` name still fails, just with a path-shaped message instead of the
documented one, and a name containing `/` is a documented path. Confidence: High.

**Resolved in code.** `resolveProfilePath` now calls `assertProfileName` on the bare-name branch
(`src/lib/chains.ts:28-45`), after the path branch has returned, so a path is still a path. One
check now covers every way a profile gets named — `-p`, `$EVM_ELF_PROFILE`, the `.default`
pointer, and the `evm profile` commands, which had it already. Verified: `chain list -p 'bad
name!'` and `EVM_ELF_PROFILE='bad name!' evm chain list` both print `Invalid profile name 'bad
name!': use letters, digits, '.', '_' or '-'` and exit `1`, where the first used to report a
missing file and the second reported one too. `docs/troubleshooting.md` records that the check
now covers `-p` and the variable.

## Undocumented behaviour (resolved)

### X1. Amounts are labelled `ETH` on every chain

`send` and `proxy-info --full` print a hardcoded `ETH` suffix regardless of the chain's
`symbol`, so a BNB, AVAX, POL, xDAI or S amount reads as ETH. The docs only ever show ETH
examples (`docs/wallet-commands.md:121`, `docs/troubleshooting.md:173`,
`docs/contract-commands.md:140`), so nothing contradicts the behaviour and nothing warns about
it either — while `wallet balance` does use the profile's symbol
(`src/commands/wallet/balance.ts:155`), which makes the inconsistency visible between commands.

Evidence: `src/commands/wallet/send.ts:84` (header), `:139` (`balance too low` message),
`:159` and `:170` (per-chain lines); `src/commands/contract/proxy-info.ts:465`
(`Balance:` line). Confidence: High.

**Resolved in code.** All five sites now take the symbol from the chain's profile entry, which
is the only thing that knows it. `send` resolves its chains before printing the header —
`resolveChain` does no I/O, so this is free — and derives a per-chain `token` suffix from
`resolved.symbol`. `proxy-info` carries `symbol` on `ProxyInfoResult`, following what
`BalanceResult` already did, so it also appears in `--json`.

Two cases have no single right answer, and both resolve to a bare number: the opening line of
`send` can name only one token, so it drops the symbol when the selected chains disagree, and a
chain whose entry sets no `symbol` gets nothing. `docs/wallet-commands.md` and `README.md` now
say so. Verified:

```text
$ evm wallet send 0xf39F… --value 0.01 --private-key … -c bsc
Wallet Send: 0.01 BNB → 0xf39F…
[1/1] bsc: would send 0.01 BNB

$ evm wallet send 0xf39F… --value 0.01 --private-key … -c base,avax,matic
Wallet Send: 0.01 → 0xf39F…
[1/3] base: would send 0.01 ETH
[2/3] avax: would send 0.01 AVAX
[3/3] matic: would send 0.01 POL
```

Also verified against a stub RPC endpoint: `skip (balance too low (0.0000000000000001 TST, gas
reserve 0.0000231 TST))` for `--all`, and `Balance: 0.01 TST` from `proxy-info --full`.

### X2. Failed rows in `wallet balance --json` carry a zero balance

`docs/wallet-commands.md:70-86` describes which keys are conditionally present but not that a
failed chain still reports `balance`, `balanceEth` and `nonce` as zeros beside its `error`.
A script that sums `balanceEth` without checking `error` under-counts silently — the outcome
the same page warns against at `docs/wallet-commands.md:256` in the exit-code discussion,
without mentioning this specific trap.

Evidence: `src/commands/wallet/balance.ts:80-91` and `:109-119`. Observed:

```json
{ "chain": "ok", "chainId": 31337, "balance": "0", "balanceEth": "0", "nonce": 0,
  "error": "connect ECONNREFUSED 127.0.0.1:9" }
```

Confidence: High.

**Documented.** The JSON paragraph in `docs/wallet-commands.md` now says a failed chain still
carries `balance`, `balanceEth` and `nonce`, all zero, that the row is a placeholder rather than
a reading, and to check `error` before adding anything up.

### X3. Eight validation messages are missing from the reference table

`docs/troubleshooting.md:276-303` presents itself as the reference for errors that "stop the
command before it reaches a chain". These are produced and are not in it:

| Message | Source |
| --- | --- |
| `Invalid contract address: <value>` | `src/commands/contract/transfer-ownership.ts:26` |
| `Invalid new owner address: <value>` | `src/commands/contract/transfer-ownership.ts:30` |
| `Invalid proxy address: <value>` | `src/commands/contract/proxy-upgrade.ts:30` |
| `Invalid implementation address: <value>` | `src/commands/contract/proxy-upgrade.ts:34` |
| `Invalid --chain-id '<value>': expected a positive integer` | `src/commands/chain/set.ts:96` |
| `--no-verify needs --chain-id, since the chain id cannot be read from the RPC` | `src/commands/chain/set.ts:104` |
| `Empty API key for '<name>': …` | `src/commands/explorer/set.ts:46` |
| `key argument is neither a hex key nor a set environment variable: <value>` | `src/commands/wallet/address.ts:15` |

The table does document `Invalid Ethereum address:` and `Invalid recipient address:`, which
cover `owner`, `proxy-info`, `code` and `send` — so a reader searching for the message the two
write commands actually print finds nothing. All eight reproduced at runtime. Confidence: High.

**Documented.** All eight are in the `docs/troubleshooting.md` table, the four address messages
naming which argument of which command each belongs to, and the two existing address rows now do
the same so the set reads as one family. The `--no-wait` message added by the X5 fix is there
too. The closing paragraph, which covered only `-c` with `-xc`, now covers all three
parser-rejected option pairs and says why `--fee-buffer` with `--value` is a different kind of
mistake from the other two. Re-verified: all sixteen messages in that table print exactly as
written.

### X4. `chain list` truncates the RPC URL

The `RPC URL` column is 45 characters and longer values are cut with an ellipsis, so a long
provider URL cannot be read off the table; `--reveal` does not affect it and only `--json`
shows the value in full. `docs/chain-commands.md:31-40` shows only URLs that fit and does not
mention truncation.

Evidence: `src/commands/chain/list.ts:15` (`rpc: 45`), `:19-21` (`truncate`), `:58-60`.
Confidence: High.

**Documented**, next to the masking rules it sits beside in `docs/chain-commands.md`: a URL
longer than the column is cut with an ellipsis, `--reveal` doesn't affect that, and `--json` is
how to read a long endpoint in full.

### X5. `--fee-buffer` and `--no-wait` are accepted where they do nothing

`--fee-buffer` is parsed and validated on every `send`, including `--value` runs where the gas
reserve it scales is never computed, so `--value 0.01 --fee-buffer 0.5` fails with
`Invalid --fee-buffer` on an option that would have had no effect. `--no-wait` is accepted in
plan mode, where nothing is broadcast to wait for. `docs/wallet-commands.md:101-108` describes
both as `--all`- and send-specific without saying they are otherwise inert.

Evidence: `src/commands/wallet/send.ts:55-59` (validated before the mode is known), `:120-155`
(reserve computed only under `options.all`), `:174` (`options.wait` read only on the send path).
Confidence: High.

**Resolved in code**, by refusing both rather than ignoring them. `--fee-buffer` now declares
`.conflicts('value')` (`src/cli/wallet.ts`), which puts it with `--value`/`--all` and `-c`/`-xc`
under the parser rather than in a hand-written check. `--no-wait` cannot be expressed that way,
since what it needs is the presence of `--exec`, so `send` checks it directly and says what is
wrong rather than which options clash. Verified:

```text
$ evm wallet send 0xf39F… --value 0.01 --fee-buffer 1.5 --private-key … -c base
error: option '--fee-buffer <multiplier>' cannot be used with option '--value <amount>'
$ evm wallet send 0xf39F… --value 0.01 --no-wait --private-key … -c base
--no-wait has no effect without --exec: a plan sends nothing
```

Both are documented: the `send` option table in `docs/wallet-commands.md`, the `--no-wait`
`--help` string, the validation table in `docs/troubleshooting.md`, and `README.md`.

### X6. An unrecognised `EVM_PRICE_SOURCE` falls back to CoinGecko

`docs/configuration.md:187-190` and `README.md:398-401` present the variable as taking one of
two values. Any third value silently selects CoinGecko, so `EVM_PRICE_SOURCE=off` or a typo
of `none` performs the price request the user meant to disable.

Evidence: `src/lib/prices/index.ts:19-26` — `switch` with `case 'none'` and `default`.
Confidence: High.

**Resolved in code, falling back to `none`.** An unset variable still means CoinGecko; a value
that is neither `coingecko` nor `none` now selects `none` and says so on stderr, which keeps
`--json` parseable. The direction matters: someone who set the variable at all meant to control
the lookup, so reaching for the network because they misspelled `none` is the wrong way to be
wrong. The warning is what stops the fallback being as silent as the behaviour it replaces.

Verified against a stub RPC endpoint, so that a price lookup was actually wanted —
`EVM_PRICE_SOURCE=off` prints `Warning: unknown price source 'off', using 'none' (valid:
coingecko, none)` and leaves the USD column empty, while `none` and `coingecko` are both silent.
The warning is raised where the source is selected, so a run that wants no prices at all
(`--no-usd`, or every chain failing) stays quiet — the same rule the explorer note follows.
Documented in the `EVM_PRICE_SOURCE` rows and price tables of `docs/configuration.md` and
`README.md`.

### X7. `code --full` prints nothing extra for an empty address

`docs/contract-commands.md:178` describes `--full` as "Print the full bytecode hex after the
table". When the address holds no code the hex is omitted from the table output entirely, while
`--json` still carries `"code": "0x"`.

Evidence: `src/commands/contract/code.ts:98-104` (`result.code && result.deployed`).
Confidence: High.

**Documented** in both halves of `docs/contract-commands.md`: the `--full` option row says it
prints nothing extra when the address holds no code, and the JSON paragraph says `--json` carries
`"code": "0x"` in that case, which the table view leaves out. Verified against a stub endpoint
returning `0x`.

## Ambiguous requirement (open)

The only findings still open. A1 and A3 have concrete fixes and were simply not part of either
fix round. A2 and A4 are claims about things outside this repository, and no amount of reading it
will settle them; they are recorded so that a future run doesn't spend time rediscovering that.
Line numbers in this section are current.

### A1. README's shared-options block over-promises `--exec`

`README.md:60-71` heads its option list "Shared by the commands that reach a chain" and
qualifies `--private-key` with "(commands that sign)" but leaves `--exec` unqualified, though
only the four signing commands accept it. The per-command sections and `docs/` are precise; the
overview reads as if `--exec` were universal.

Evidence: `--exec` declared at `src/cli/wallet.ts:47` and `:95`, `src/cli/contract.ts:41` and
`:81`, and nowhere else.

### A2. Explorer coverage figures cannot be checked against the code

`docs/configuration.md:219-220` states Etherscan v2 covers "64 chains, listed at
`api.etherscan.io/v2/chainlist`" and Blockscout "120+ chains, key required since July 2026".
Nothing in the code enumerates or fetches either list — `src/lib/explorer/index.ts:40-43` holds
only two base URLs — so these are external, time-sensitive facts with no counterpart to verify
against. `docs/troubleshooting.md:262` repeats them, so a change dates two pages.

### A3. The cross-chain codehash comparison is conditional

`docs/contract-commands.md:154` states `--full` adds "the implementation codehash, plus a
cross-chain comparison that reports whether the bytecode is identical everywhere or lists the
variants when it isn't", unconditionally. The comparison is skipped unless at least two chains
in the run produced an implementation codehash, so the documented output is absent from the
single-chain invocation the page itself demonstrates at `docs/contract-commands.md:125`.

Evidence: `src/commands/contract/proxy-info.ts:726-730` (`withHash.length < 2` returns early).

### A4. "The provider is pinned to it, so a wrong value fails loudly"

`docs/configuration.md:87` promises that a wrong `chain_id` "fails loudly instead of returning
another chain's data". The code creates providers with an explicit chain id and
`staticNetwork: true` (`src/lib/rpc.ts:33-35`), which delegates the guarantee to ethers rather
than asserting it in this codebase. Consistent with the claim, unverifiable offline, and not
covered by a test.

## Verified, by area

Recorded so a future run can see what was covered rather than re-deriving it. Everything below
matched, at runtime unless marked **code-only**. Where a fix changed the behaviour, the entry
describes it as it now stands.

**Command surface.** All five command groups and 21 subcommands exist with the documented
names, arguments, and options; `--json` on every subcommand (`README.md:17`); `-c`/`-xc`
declared mutually exclusive and rejected by the parser with the parser's own message
(`docs/troubleshooting.md:301`); `-c` required and single-valued on the two write commands, with
a comma rejected (`docs/contract-commands.md:204`); `evm --help` lists the five groups and the
resolved profiles path (`docs/configuration.md:21`); `--version` prints `1.0.0`.

**Chain selection and fan-out.** `-c` list, `-xc` subtraction, and the whole profile as the
default (`docs/configuration.md:128-136`); the exact `Warning: excluded chain 'x' is not in
profile 'y'` on stderr (`:143`); `Not in profile 'default' (evm chain set … <rpc-url>)` as a row
rather than a failure (`docs/troubleshooting.md:95`); sequential rather than parallel queries
(`:148`, code-only).

**Profile resolution.** The four-source precedence `-p` → `$EVM_ELF_PROFILE` → `.default` →
`default` (`docs/configuration.md:27-34`), for every command and whether the variable is exported
or set in a `.env` file (after C8); `-p` as a path when it contains `/` (`:36`); the bare-name
pattern enforced for `-p` and `$EVM_ELF_PROFILE` as well as the `profile` commands (`:42`, after
U2); the `<name>.yml` fallback (`:42`); `default` alone created on demand, however it is named,
with the exact first-run stderr line (`:23`, `docs/installation.md:48-54`); `Profile not found`
carrying the `$EVM_ELF_PROFILE` and `.default` provenance hints (`docs/troubleshooting.md:60`).

**Profile file parsing.** Both required and all four optional chain fields; `has unknown field
'rpc_urls'` rejecting the file (`docs/troubleshooting.md:76`); `No chain_id set` and `No RPC URL
configured` as per-chain rows while other chains run (`docs/configuration.md:92`);
`Environment variable ARBITRUM_RPC_URL not set` per chain (`:120`); `Invalid RPC URL: expected
<URL> or <URL>|<AUTH_KEY>` for a second pipe (`:103`); `${VAR}` resolved before the pipe split
(`:106`, code-only); `unknown explorer '<name>' (known: etherscan, blockscout)` (`docs/troubleshooting.md:299`).

**Profile commands.** `list` marking the profile in use and naming the source of the choice, and
showing a broken profile as `error` with the parse error beneath (`docs/profile-commands.md:35-37`);
`create` reporting 14 chains in the bundled order, `--empty`, and `Profile already exists`
(`:57`, `:69`); `clone` byte-for-byte from a name or a path (`:73`); `remove` refusing the profile
in use with the documented sentence, clearing the pointer under `--force`, and allowing `default`
(`:100-108`); `set-default` requiring the profile to exist except for `default`, printing `was
<previous>`, and warning when `$EVM_ELF_PROFILE` overrides it (`:112-128`); all five exit codes
(`:130-140`).

The three that turned on where `EVM_ELF_PROFILE` was set — the profile `list` names as in use
and the source it attributes it to, the `remove` refusal, and the `set-default` override warning
— now hold for a `.env` file as well as for an export (after C8).

**Chain commands.** `list` layout, per-chain metadata, and the masking rules — reference shown as
written with `(unset)`, literal reduced to `****last4`, `--json` unmasked
(`docs/chain-commands.md:40-43`, `docs/private-keys.md:108`); `set` reading the id with
`eth_chainId` and a 5s timeout, `Could not read the chain id from <url>: <cause>` plus the
`--no-verify --chain-id` fallback line, `Chain id mismatch: … Nothing written.`, metadata
inherited from the bundled profile by chain id and overridden by the explicit options,
`--symbol ''` clearing a field, repeatable `-H` and `--remove-header`, comments and key order
preserved (`docs/chain-commands.md:56-107`); `set` and `remove` both refusing a profile that does
not exist, and `-p default` seeding the bundled profile on a fresh machine (after C4); `remove`
listing the configured chains on a miss (`:122`); all three exit codes (`:128-132`).

**Explorer commands.** `list` output including both endpoints and the closing order line, and the
three `API Key` states (`docs/explorer-commands.md:33-48`); the `--json` shape (`:52-60`);
`set` restricted to `etherscan`/`blockscout`, probing a long-verified contract before writing,
`<explorer> rejected the key: <reason>` and `Could not resolve ${VAR}: …` both with `Pass
--no-verify to write the entry anyway.`, `key accepted by the explorer` versus `key not checked
(--no-verify)`, `Added`/`Updated` reflecting whether the entry was new (`:65-131`, probe path
code-only); `set` and `remove` both refusing a profile that does not exist (after C4); `remove`
listing what is configured on a miss (`:149-153`); all three exit codes (`:159-163`).

**Explorer access.** Source order `explorer_api` → etherscan → blockscout, with the order not
configurable (`docs/configuration.md:201-213`); a source whose key is missing or whose `${VAR}`
does not resolve dropped before any request (`:211`); the exact `Skipped explorer lookups: …`
note, once per run, on stderr so `--json` stays parseable, and silent under `-s`
(`:215-223`, code-only); a rejected key falling through to the next source without a note
(`:225`, code-only).

**Wallet commands.** `balance` accepting an address, a key, or a variable name holding either,
the pending nonce, `-` and exclusion from the total for unpriced chains, the closing `No price
for: …` line, `<$0.01` for dust, per-chain errors in `Status`, `--no-usd` dropping the column,
and the documented JSON shape including the zeroed keys on a failed row (`docs/wallet-commands.md:32-86`,
after X2); `send` requiring exactly one of `--value`/`--all`, the ether and wei value forms,
`--fee-buffer` default `1.1` and `>= 1` and refused alongside `--value`, `--no-wait` refused
without `--exec` (after X5), `gasLimit × maxFeePerGas × --fee-buffer` as the reserve, gas
parameters pinned under `--exec`, a `--value` dry run not reading balances, amounts named in the
chain's own `symbol` (after X1), every `Status` value, a plan that names the recipient but not the
signer, and exit `1` only when every chain errored with skips not counting (`:88-162`, `:250`);
`set-nonce` skipping chains at or above target with both messages, the 2s/60s poll and its
timeout status (`:164-200`); `generate` with `--words 12|24` and the JSON shape; `address`
deriving locally, resolving a key from a `.env` file (after C1), and its JSON shape; all five
exit codes (`:244-253`); and reads reaching no chain still exiting `0` (`:256`).

**Contract commands.** `owner` with `no code at address`, `no owner() function`, and the RPC
error as row values (`docs/contract-commands.md:49`); all seven `proxy-info` types and the fields
each reports, `n/a` for an absent field, the `(EOA - upgrades sent directly by this account)`
flag, `-s` skipping owner lookups, `--short` and `--full` mutually exclusive, and every `--full`
field including the OZ v5 ERC-7201 slot and the OZ v4 slot-0 heuristic with its label
(`:53-166`; the UUPS branch, the `--full` extras and the `Balance:` symbol verified against a
stub RPC endpoint, the other six types code-only); `code` reporting size and `deployed`/`empty`,
`--full` requiring exactly one chain and printing nothing extra for an empty address (after X7),
and the JSON keys (`:168-193`); `transfer-ownership` with its three
dry-run checks, the `Warning: signer is NOT the current owner` line, `Static call succeeded`
versus `Static call reverted: <reason>`, a dry run exiting `0` either way, `static call reverted,
not sending: <reason>` under `--exec`, and `owner()` re-read after the send
(`:195-233`, send path code-only); `proxy-upgrade` taking the proxy and reading the admin slot,
`--data` `0x`-prefixed and defaulting to `0x`, three dry-run warnings, two of them refusals under
`--exec`, three conditions that are errors in either mode with their exact messages, and the slot
re-read afterwards (`:235-273`, send path code-only); both exit-code tables (`:275-285`).

**Private keys.** Both accepted forms and the 64-hex-character discrimination
(`docs/private-keys.md:11`); all four key-resolution messages (`docs/troubleshooting.md:147-167`);
a key supplied from a `.env` file working for every command that takes one, including
`wallet address` (`docs/private-keys.md:42-53`, after C1); a shell variable winning over both
`.env` files (`:60`); the four commands that sign and the two that take a key without signing
(`:5`, after C5); no field of a profile accepting a key (`:99`); no key printed anywhere but
`wallet generate`, which the docs call out as printing secrets by design (`:100`, `:107`).

**Prices.** CoinGecko `simple/price` as the default with one batched request, a 5s timeout,
`COINGECKO_API_KEY` as a demo key, `none` disabling lookups, an unrecognised value falling back
to `none` with a warning (after X6), best-effort failure leaving the column empty, and `sepolia`
unpriced by design (`docs/configuration.md:183-196`; the CoinGecko request itself is code-only).

**Packaging.** Node 22 floor, `bin` → `dist/index.js`, `files` shipping `dist` and `config`,
`prepare` running `tsc`, the four documented npm scripts, and LICENSE carrying both copyright
notices (`README.md:405-425`, `docs/installation.md:7-17`).

## Documentation defects unrelated to behaviour (resolved)

Not behaviour mismatches, but they broke the rendered page. All in `docs/wallet-commands.md`,
which is the only page affected.

1. **Five links wrapped in backticks** (`:12-16`). Every cell of the command table wrapped the
   whole link in a code span, so the row rendered as literal markup instead of as a link. Fixed
   by moving the backticks inside the link text:

   ```markdown
   | `[balance](#evm-wallet-balance-wallet)` |   before: renders as raw markup
   | [`balance`](#evm-wallet-balance-wallet) |   after:  renders as a code-styled link
   ```

   That is the form `docs/contract-commands.md:11-15` already used, so the two command tables now
   match. The anchors were correct all along and still are.

2. **Bold and code spans interleaved the wrong way round** (`:65`, `:66`, `:68`, `:112`). The
   author wanted bold text with a code span inside it and opened the backtick first, so the code
   span swallowed the `**`:

   ```markdown
   - `**Nonce` is the pending nonce**, which counts transactions in the mempool …
   ```

   The emphasis marker ends up inside the code span and the sentence renders scrambled. Fixed to
   `**The \`Nonce\` column is the pending nonce**, …` and likewise for the other three.

   A scan for the pattern across `README.md` and every page found a fourth instance that the
   first two rounds had missed, and the worst placed of the four: the opening line of the
   `--all --exec` caution block at `:112`, which is the strongest warning in the documentation.
   Everything else the scan matched had the backticks correctly inside the emphasis.

Checked afterwards with an anchor validator over all ten pages, applying GitHub's slug rules to
every heading: all in-page and cross-page anchor links resolve.

## Recommendations

What is left. Everything from the three finding rounds is closed; these are the four open items
plus the one thing the rounds made obvious.

1. **Write the first tests, starting with `profile remove`'s in-use guard.** This is the top
   recommendation because it is the lesson of the whole exercise rather than one more finding.
   There is still no test suite, and one would have caught U1, U2, X2, X5, X6, both file-handling
   conflicts and every symptom of C1 and C8 — which is why runtime output had to stand in for one
   across all three rounds. The guard deserves to be first: it is the only destructive operation
   in the CLI, and C8 showed its safety resting on `loadEnv()` having been called, which nothing
   enforces. A test that puts `EVM_ELF_PROFILE` in a `.env` file and asserts the refusal is the
   one that would have caught it. The stub JSON-RPC endpoint used to verify X1, X6 and X7 in this
   round is about thirty lines and would give the fan-out commands somewhere to run.
2. **Qualify `--exec` in README's shared-options block** (A1), the way `--private-key` already
   is. One word, and the overview stops implying that every command that reaches a chain can
   send.
3. **Say that the cross-chain codehash comparison needs two chains** (A3), since the page states
   it unconditionally and demonstrates it with `-c base`, where it never appears.
4. **Decide who owns the explorer coverage figures** (A2). "64 chains" and "120+ chains, key
   required since July 2026" appear on two pages, are true of the outside world rather than of
   this code, and nothing here will notice when they stop being true. Either drop the numbers or
   accept that they are a dated claim and date them.
5. **Consider whether A4 wants a test rather than a promise.** `docs/configuration.md:87` says a
   wrong `chain_id` "fails loudly"; that guarantee currently belongs to ethers'
   `staticNetwork`. A test against the stub endpoint would make it this project's guarantee.
