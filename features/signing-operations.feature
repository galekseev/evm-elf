# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, stories 1 and 9
#
# The send paths are tagged @code-only: reaching them costs a broadcast
# transaction on a live chain. They are the least exercisable behaviour in the
# system and the most expensive to get wrong, which is why they are specified in
# the most detail. The dry runs and the pre-send refusals carry no tag — they
# send nothing, and test/characterization/signing-dry-runs.test.ts reaches all
# nine of them against a JSON-RPC stub that can answer a simulated call with a
# revert.

Feature: Signing operations
  An operator is about to move funds, bump a nonce, hand over ownership, or
  upgrade a proxy — the four things this CLI does that cannot be undone.

  A broadcast transaction cannot be recalled, cancelled, or refunded, and there
  is no confirmation prompt anywhere in the tool. The plan printed by a dry run
  is the only confirmation step that exists, which is what makes every rule
  below about what the plan says.

  Background:
    Given an empty configuration directory
    And the environment variable "DEPLOYER_PK" holds the operator's private key

  Rule: wallet send reports one of six per-chain outcomes (REQ-095)

    @REQ-095
    Scenario Outline: The status names what happened on that chain
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" is in the state "<state>"
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 <options> --private-key DEPLOYER_PK -c solo -p work"
      Then the "Status" cell reads "<status>"
      And the progress line for "solo" says the same thing

      Examples: Reachable from a terminal
        | state                       | options      | status                                                    |
        | healthy                     | --value 0.01 | will send                                                 |
        | a zero balance              | --all        | skip (zero balance)                                       |
        | a balance below the reserve | --all        | skip (balance too low (<balance>, gas reserve <reserve>)) |
        | unreachable                 | --value 0.01 | the chain's error message                                 |

      @code-only
      Examples: Needing a live chain
        | state   | options                       | status                         |
        | healthy | --value 0.01 --exec           | sent, block <n>                |
        | healthy | --value 0.01 --exec --no-wait | sent (not waiting for receipt) |

  Rule: A sweep pins the gas parameters it planned with (REQ-092)

    @REQ-092 @code-only
    Scenario: The fee cannot exceed the reserve the plan held back
      Given a profile "work" with 1 funded chain
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --private-key DEPLOYER_PK -c solo -p work --exec"
      Then the broadcast transaction carries the gas limit used to compute the reserve
      And it carries the same fee parameters
      And whatever the reserve does not spend stays behind as dust

  Rule: set-nonce sends one transaction per missing nonce (REQ-099)

    @REQ-099
    Scenario: The plan says how many transactions the alignment needs
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" reports a transaction count of 34
      When I run "evm wallet set-nonce 40 --private-key DEPLOYER_PK -c solo -p work"
      Then the "Txs Needed" cell reads "6"
      And no transaction is broadcast

    @REQ-099 @code-only
    Scenario: Under --exec each missing nonce gets its own zero-value self-transaction
      Given a chain whose transaction count is 34
      When I run "evm wallet set-nonce 40 --private-key DEPLOYER_PK -c solo -p work --exec"
      Then six transactions are sent, with nonces 34 through 39
      And each carries an explicit nonce
      And the command does not wait between them

  Rule: The transfer-ownership dry run performs three checks (REQ-116)

    @REQ-116
    Scenario: The plan reports what it found and what it would do
      Given a profile "work" with 1 chain
      And the address 0x0000000000000000000000000000000000000001 exposes owner()
      When I run "evm contract transfer-ownership 0x0000000000000000000000000000000000000001 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF --private-key DEPLOYER_PK -c solo -p work"
      Then standard output names the contract, the current owner, the new owner and the signer
      And standard output contains "Static call succeeded"
      And standard output contains "Re-run with --exec to send the transaction"

    @REQ-116
    Scenario: A signer that does not own the contract is warned about, not stopped
      Given the signer is not the current owner
      When I run the transfer-ownership dry run
      Then standard output contains "Warning: signer is NOT the current owner"
      And the static call is attempted anyway

    @REQ-116
    Scenario: A revert in simulation costs nothing and is reported with its reason
      Given the transfer would revert
      When I run the transfer-ownership dry run
      Then standard output contains "Static call reverted: <reason>"

  Rule: A reverting dry run still exits 0 (REQ-118)

    @REQ-118
    Scenario Outline: The exit code of a plan does not depend on what the plan found
      Given the <command> would revert
      When I run the dry run
      Then the exit code is 0
      And the revert reason is printed
      # A script must read the output rather than the exit code — R7:230.

      Examples:
        | command            |
        | transfer-ownership |
        | proxy-upgrade      |

  Rule: Under --exec, transfer-ownership refuses a reverting transfer and confirms a successful one (REQ-117)

    @REQ-117
    Scenario: A revert in simulation stops the broadcast
      Given the transfer would revert
      When I run the transfer-ownership command with "--exec"
      Then the exit code is 1
      And standard error contains "static call reverted, not sending: <reason>"
      And nothing is broadcast

    @REQ-117 @code-only
    Scenario: A successful transfer is confirmed by re-reading the owner on chain
      Given the transfer would succeed
      When I run the transfer-ownership command with "--exec"
      Then the receipt is waited for
      And owner() is read again after the receipt
      And the reported new owner is the value read back, not the value asked for
      And the transaction hash and block are reported

  Rule: proxy-upgrade takes the proxy and finds the admin itself (REQ-119)

    @REQ-119
    Scenario: The operator supplies the proxy, and the command reports an admin they did not type
      Given a transparent proxy at 0x0000000000000000000000000000000000000001
      When I run "evm contract proxy-upgrade 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 --private-key DEPLOYER_PK -c solo -p work"
      Then standard output carries a "Proxy admin:" line
      And that address was read from the proxy's EIP-1967 admin slot

  Rule: The proxy-upgrade dry run warns about three conditions and continues (REQ-121)

    @REQ-121
    Scenario Outline: Each warning is raised, and none of them stops the plan
      Given <condition>
      When I run the proxy-upgrade dry run
      Then standard output carries a warning about it
      And the upgrade is static-called regardless

      Examples:
        | condition                                            |
        | the new implementation holds no code                 |
        | the signer is not the ProxyAdmin's owner             |
        | the proxy already points at the named implementation |

  Rule: Under --exec, proxy-upgrade refuses two of those three (REQ-122)

    @REQ-122
    Scenario Outline: A refusal broadcasts nothing
      Given <condition>
      When I run the proxy-upgrade command with "--exec"
      Then the exit code is 1
      And standard error contains "<message>"
      And nothing is broadcast

      Examples:
        | condition                            | message                                     |
        | the new implementation holds no code | new implementation has no code, not sending |
        | the static call reverts              | static call reverted, not sending: <reason> |

    @REQ-122 @code-only
    Scenario: Not owning the ProxyAdmin does not block the send
      Given the signer is not the ProxyAdmin's owner
      And the static call succeeds
      When I run the proxy-upgrade command with "--exec"
      Then the transaction is broadcast

  Rule: Three conditions fail proxy-upgrade in either mode (REQ-123)

    @REQ-123
    Scenario Outline: The address is not the kind of proxy this command upgrades
      Given <condition>
      When I run "evm contract proxy-upgrade 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 --private-key DEPLOYER_PK -c solo -p work"
      Then the exit code is 1
      And standard error is exactly "<message>"

      Examples:
        | condition                                | message                                                                                  |
        | the proxy address holds no code          | no code at proxy address                                                                 |
        | the EIP-1967 admin slot is empty         | EIP-1967 admin slot is empty (not a transparent proxy?)                                  |
        | the admin is an externally owned account | admin <address> is an EOA, not a ProxyAdmin contract (upgrade it directly via the proxy) |

    @REQ-123 @code-only
    Scenario: After a send, the implementation slot is read back
      Given a successful upgrade
      When the implementation slot does not hold the requested implementation
      Then standard output contains "Warning: implementation slot does not match the requested implementation"

  Rule: A write command exits 1 on any validation, setup, or send error (REQ-124)

    @REQ-124
    Scenario: The asymmetry between reads and writes
      Given a profile "work" containing:
        """
        chains:
          down:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
        """
      When I run "evm contract transfer-ownership 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 --private-key DEPLOYER_PK -c down -p work"
      Then the exit code is 1
      # A read against the same unreachable chain exits 0 — REQ-007.

    @REQ-103
    Scenario Outline: The wallet commands' exit codes
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      When I run "evm wallet <invocation> -p work"
      Then the exit code is <code>

      Examples:
        | invocation                                                                             | code |
        | balance 0x0000000000000000000000000000000000000001 --no-usd                            | 0    |
        | balance NOPE                                                                           | 1    |
        | address DEPLOYER_PK                                                                    | 0    |
        | address NOPE                                                                           | 1    |
        | generate                                                                               | 0    |
        | generate --words 18                                                                    | 1    |
        | set-nonce 40 --private-key NOPE                                                        | 1    |
        | send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK | 0    |
