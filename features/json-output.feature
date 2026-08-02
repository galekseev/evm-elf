# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 11

Feature: Machine-readable output
  A script runs the CLI and has to decide what happened without reading a table.

  This mode exists because of one asymmetry: a per-chain failure does not change
  the exit code for a read, so the exit code cannot carry it. The JSON is the
  channel that does. That also makes two things load-bearing — diagnostics must
  stay off standard output, and stored values must round-trip unmasked.

  Background:
    Given an empty configuration directory

  Rule: All 21 subcommands accept --json, and the output parses (REQ-004)

    @REQ-004
    Scenario: Every subcommand offers the machine path
      When I run each of the 21 subcommands with "--json"
      Then none rejects it as an unknown option
      And each one's standard output parses as JSON

    @REQ-004
    Scenario: A fan-out command returns one object per selected chain
      Given a profile "work" with chains:
        | name  | chain_id | rpc_url                 | symbol |
        | one   | 31337    | http://127.0.0.1:{stub} | ETH    |
        | two   | 31337    | http://127.0.0.1:{stub} | ETH    |
        | three | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "{stub}" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd --json"
      Then standard output parses as a JSON array of 3 objects
      And the objects name "one", "two" and "three" in selection order

  Rule: Diagnostics go to standard error, so redirecting it leaves parseable JSON (REQ-006)

    @REQ-006 @REQ-015
    Scenario: The first-run seeding notice does not corrupt the JSON
      When I run "evm chain list --json" and discard standard error
      Then standard output parses as JSON

    @REQ-006 @REQ-069
    Scenario: The excluded-chain warning does not corrupt the JSON
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work -xc ghost --json" and discard standard error
      Then standard output parses as JSON

    @REQ-006 @REQ-126
    Scenario: The unknown price-source warning does not corrupt the JSON
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "EVM_PRICE_SOURCE" is exported as "off"
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --json" and discard standard error
      Then standard output parses as JSON

    @REQ-006 @REQ-131
    Scenario: The skipped-explorer note does not corrupt the JSON
      Given a profile "work" with 1 chain
      And no explorer key is configured
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work --json" and discard standard error
      Then standard output parses as JSON

    @REQ-006 @REQ-027
    # The two closing lines of `profile list` fall on either side of REQ-006. The
    # legend is part of the answer, so it stays on stdout; the missing-default
    # line reports a problem with the machine's state, so it does not. Resolved
    # in the code on 2026-08-01, which had printed both on stdout.
    Scenario: The legend is a result and the missing-default warning is a diagnostic
      Given a profile "alpha" with no chains
      And the default pointer names "ghost"
      When I run "evm profile list"
      Then the exit code is 0
      And standard error carries the warning that "ghost" does not exist
      And standard output carries the table and nothing about "ghost"

    @REQ-006 @REQ-027
    Scenario: With the profile in use present, the legend is on stdout and stderr is empty
      Given a profile "alpha" with no chains
      And the default pointer names "alpha"
      When I run "evm profile list"
      Then standard output contains "* in use: alpha (set by evm profile set-default)"
      And standard error is empty

  Rule: --json carries stored profile values unmasked, where the table masks them (REQ-048, REQ-049)

    @REQ-048
    Scenario Outline: The table masks a literal and prints a reference as written
      Given a profile "work" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            headers:
              auth-key: <stored>
        """
      And the environment variable "BASE_KEY" is not exported
      When I run "evm chain list -p work <flag>"
      Then standard output shows the header value as "<shown>"

      Examples: Without --reveal
        | stored               | flag | shown               |
        | supersecretvalue1234 |      | ****1234            |
        | tiny                 |      | ****                |
        | ${BASE_KEY}          |      | ${BASE_KEY} (unset) |

      Examples: With --reveal, which changes literals only
        | stored               | flag     | shown                |
        | supersecretvalue1234 | --reveal | supersecretvalue1234 |
        | ${BASE_KEY}          | --reveal | ${BASE_KEY} (unset)  |

    @REQ-049
    Scenario: The same profile under --json prints the stored value in full
      Given a profile "work" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            headers:
              auth-key: supersecretvalue1234
        """
      When I run "evm chain list -p work --json"
      Then the JSON carries the header value "supersecretvalue1234"
      And nothing in the JSON is masked

    @REQ-049
    Scenario: An explorer key round-trips through --json unmasked
      Given a profile "work" whose "explorers" section sets etherscan to "supersecretvalue1234"
      When I run "evm explorer list -p work --json"
      Then the JSON carries "supersecretvalue1234"
      And the table form of the same command shows "****1234"

  Rule: --json carries the full value where the table truncates it (REQ-050)

    @REQ-050
    Scenario: A long RPC URL is truncated in the table and whole in the JSON
      Given a profile "work" whose chain "base" has an rpc_url of 80 characters
      When I run "evm chain list -p work"
      Then the "RPC URL" cell holds the first 44 characters followed by "…"
      And "--reveal" does not change that truncation
      But "evm chain list -p work --json" carries the URL in full

  Rule: A per-chain failure is carried as data, because the exit code will not carry it (REQ-007, REQ-085)

    @REQ-007 @REQ-085
    Scenario: A script has to read the error key rather than the exit code
      Given a profile "work" containing:
        """
        chains:
          up:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
          down:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
        """
      And the endpoint "up" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd --json"
      Then the exit code is 0
      And the object for "up" carries no "error"
      And the object for "down" carries a populated "error"
      And the object for "down" carries "balance": "0", "balanceEth": "0" and "nonce": 0

    @REQ-070
    Scenario: A chain the profile does not define is an object like any other
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm contract owner 0x0000000000000000000000000000000000000001 -p work -c ghost --json"
      Then the exit code is 0
      And the array holds one object, for "ghost"
      And its error reads "Not in profile 'work' (evm chain set ghost <rpc-url>)"

  Rule: Named commands carry named keys (REQ-039, REQ-065, REQ-101, REQ-102, REQ-114, REQ-115)

    @REQ-039
    Scenario: profile list carries the same answer as its marker and its legend
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And the default pointer names "beta"
      When I run "evm profile list --json"
      Then the JSON carries "default": "beta"
      And the JSON carries a "source" naming the pointer file
      And that agrees with the "*" marker in the table form

    @REQ-065
    Scenario: explorer set reports novelty and verification as booleans
      Given a profile "work" with no chains
      When I run "evm explorer set etherscan somekey --no-verify -p work --json"
      Then the JSON carries "added": true
      And the JSON carries "verified": false

    @REQ-101
    Scenario: wallet generate carries the three fields a secret manager needs
      When I run "evm wallet generate --json"
      Then the JSON carries "address", "mnemonic" and "privateKey"

    @REQ-102
    Scenario: wallet address carries only the address
      Given the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet address DEPLOYER_PK --json"
      Then the JSON is exactly {"address": "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"}

    @REQ-114
    Scenario: contract code carries the size and the verdict
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" holds code at 0x0000000000000000000000000000000000000001
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work --json"
      Then each object carries "codeSize" and "deployed"

    @REQ-115
    Scenario: An address with no code still carries a code field
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" holds no code at 0x0000000000000000000000000000000000000001
      When I run "evm contract code 0x0000000000000000000000000000000000000001 --full -c solo -p work --json"
      Then the JSON carries "code": "0x"
      But the table form prints "0 B" and "empty" with no hex block

  Rule: The machine path never changes the exit code the table form would give (REQ-005, REQ-103)

    @REQ-103 @REQ-005
    Scenario Outline: --json is a formatting choice, not a behavioural one
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      When I run "evm <command> -p work" with and without "--json"
      Then both exit codes are <code>

      Examples:
        | command                                                            | code |
        | chain list                                                         | 0    |
        | wallet balance 0x0000000000000000000000000000000000000001 --no-usd | 0    |
        | wallet balance NOPE                                                | 1    |
        | contract owner notanaddress                                        | 1    |
