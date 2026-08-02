# Behaviour specifications

Executable-style behaviour specifications for the `evm` binary, in Gherkin.
Fourteen feature files tracing to all but four of the requirements in
[the approved requirements specification](../docs/reverse-engineer/requirements-specification.md);
[what is deliberately absent](#what-is-deliberately-absent) names the four.

These are the specification, not a record of the implementation. Where the two
disagreed, the scenario stated the requirement and carried a `@conflict` tag.
Nine did when these were written. All nine have been ruled on: six in the
implementation's favour, with the requirement amended and dated in place, and
three in the specification's, with the code changed to match. None is open.

## Reading order

Start with [the example map](example-map.md) — the Phase 1 artefact these came
from. It carries the rules, the examples behind each one, the questions no
scenario answers, and an elaboration on each conflict that needed one.

| File | Covers |
| --- | --- |
| [`command-execution.feature`](command-execution.feature) | A command that does what it was asked: the 21 subcommands, fan-out, the dry run, and what an edit preserves |
| [`arguments.feature`](arguments.feature) | Every documented rejection — option exclusivity, name and key validation, missing arguments |
| [`help-and-version.feature`](help-and-version.feature) | `--version`, help at all three levels, and the configuration block only root help carries |
| [`configuration.feature`](configuration.feature) | First-run seeding, missing-profile provenance, and every way a profile can be malformed |
| [`environment.feature`](environment.feature) | The four-source profile precedence, both `.env` files, `${VAR}` references, and the price source |
| [`working-directory.feature`](working-directory.feature) | What the working directory decides, and what it does not |
| [`filesystem-failures.feature`](filesystem-failures.feature) | Atomic writes, `0600`, refusals, and what a refused write says |
| [`external-services.feature`](external-services.feature) | Unreachable endpoints, bounded waits, best-effort prices, the explorer walk |
| [`idempotency.feature`](idempotency.feature) | Every repeat that is safe, and the two that are deliberately not |
| [`interruption.feature`](interruption.feature) | Signals, self-imposed timeouts, and what survives either |
| [`json-output.feature`](json-output.feature) | `--json` on all 21 subcommands, stream discipline, masking, and the per-chain error |
| [`key-handling.feature`](key-handling.feature) | What becomes of a private key: never stored, never printed, signed locally |
| [`contract-inspection.feature`](contract-inspection.feature) | The seven proxy types, the `--full` diagnostics, and the explorer-backed fields |
| [`signing-operations.feature`](signing-operations.feature) | The four commands that can broadcast, and everything they check first |

## Tags

Every scenario carries at least one `@REQ-NNN` tag naming the requirement it
comes from. Two further tags mean something.

`@conflict` — the scenario states what the requirement demands, and the
implementation does something else. The deviation is spelled out in a comment
above the scenario, with the question number from the example map. Such a
scenario fails against the build, which is the point: it needs a human to rule
on whether the code changes or the requirement does. None is currently open.

A scenario whose conflict has been ruled on loses the tag and gains a comment
naming the amendment and its date, so the reason the scenario says what it says
survives longer than the conversation that decided it.

`@code-only` — reaching this behaviour needs something the terminal cannot
supply: a chain that will accept a transaction, an answer from a service whose
address is fixed in the source, an endpoint slow enough to time, or an
installation missing one of its own files. `npm run check:features` counts the
tag: nineteen, one of which is an `Examples` block on an outline whose other
block is reachable.

Thirteen of the nineteen belong to the four commands that can write —
`wallet send`, `wallet set-nonce`, `contract transfer-ownership`,
`contract proxy-upgrade` — and every one of the thirteen needs a transaction
actually broadcast. They are spread over `signing-operations.feature` (six),
`interruption.feature` (three), `key-handling.feature` and
`idempotency.feature` (two each).

Three need an answer from a service no profile can redirect. Both REQ-062
scenarios go through `evm explorer set`, whose probe is built against the
hardcoded base URL of the named source with no per-chain override. The REQ-019
scenario watches a price request for a CoinGecko demo-key header, and that URL
is a constant too: `EVM_PRICE_SOURCE` turns the lookup off rather than aiming it
at a stub.

The last three are one apiece, and none of them is about broadcasting. REQ-129
asserts that a chain's own `explorer_api` is tried *before* the shared sources;
offline those sources cannot answer either way, so the order is not observable
even though the rest of the walk is. REQ-071 asserts that a fan-out costs the
sum of its endpoints rather than the slowest of them, which is a reading of the
clock across three deliberately slow endpoints. REQ-140 needs an installation
whose bundled `config/default-profile.yaml` is missing.

Nine more carried the tag until recently, all of them in
`signing-operations.feature`: the two contract commands' plans, the warnings a
plan raises, the addresses `proxy-upgrade` refuses outright, and the two
refusals that stop `--exec` before it broadcasts. They were tagged with the send
paths of the commands they belong to rather than each for its own reason, and
they send nothing, so `test/characterization/signing-dry-runs.test.ts` reaches
all nine. The ones that turn on a static call reverting with a reason needed the
RPC stub to answer a simulated call the way a node does — with a revert response
in place of return data — which it now does; the rest assert no more than the
bytecode and storage slots the suite already stubs for proxy detection.

The proxy branches and most of the explorer-backed fields were tagged until they
were reached offline too, as Q16 of the example map anticipated: proxy detection
against storage slots and bytecode a local JSON-RPC stub answers, and the
explorer-backed fields against a local Etherscan-dialect stub, reached through a
chain's own `explorer_api` rather than by patching the shipped endpoints. Q16 is
the Phase 1 question and the answer it was given at the time; the composition
above is the current one, and `npm run check:features` prints the total on every
run.

## Notation

Braces are values the harness supplies, angle brackets are Gherkin.

| Form | Means |
| --- | --- |
| `{config}` | The resolved configuration directory |
| `{root}` | The throwaway root a scenario runs under |
| `{stub}` | The port of a local stub JSON-RPC endpoint |
| `{endpoint}` | The endpoint the preceding Given introduced |
| `{silent endpoint}` | An endpoint that accepts the connection and never answers |
| `<column>` | A `Scenario Outline` placeholder, filled from `Examples` |

Angle brackets also appear inside quoted expected output — `expected
<name>:<value>`, `-c <chain>`. That is the CLI's own literal text, and a comment
says so wherever it could be misread. Adding an `Examples` column with one of
those names would silently corrupt the expected message.

## What is deliberately absent

Four requirements have no scenario, all from §3.6 Design Constraints: REQ-139
(the Node.js 22 floor), REQ-141 (build and run-from-source scripts), REQ-142
(the five runtime dependencies), and REQ-143 (MIT licensing). Each is a property
of `package.json` or `LICENSE` rather than a behaviour of the binary, and the
specification assigns all four the Inspection method. Writing them as Gherkin
would describe reading a manifest, not running a command.

## Relationship to the test suite

[`test/characterization/`](../test/characterization) is a separate artefact with
the opposite purpose. It pins the behaviour of the build as it is today, so an
unintended change fails a test — including the behaviour these features
contradict, which it records with `[MISMATCH REQ-NNN]` comments. Read together:
the feature says what should happen, the characterization test says what does.

The `@conflict` scenarios and the `[MISMATCH]` tests were the same disagreements
seen from either side, so they closed in pairs. All nine have been ruled on, and
no `[MISMATCH]` tag remains in the suite.

Its `// REQ-NNN` comments are validated the way these files' `@REQ-NNN` tags
are: `npm run check:docs` fails if one names a requirement the specification
does not define, and recomputes §4.1's coverage column and §4.4's mapping from
them, so neither can drift from the suite unnoticed.
