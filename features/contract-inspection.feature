# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 1
#
# Most scenarios here were tagged @code-only: the specification records that six
# of the seven proxy branches, and every explorer-backed field, need something a
# terminal alone cannot supply. None is now. Detection reads storage slots and
# bytecode, which a local JSON-RPC stub can answer, and the explorer-backed
# fields are reached by pointing a chain's own explorer_api at a local
# Etherscan-dialect stub. Every scenario in this file runs offline.

Feature: Contract inspection
  An operator has the same deployment at one address on several chains and wants
  to know what sits there — a proxy or not, which kind, who can upgrade it, and
  whether the implementation is the same everywhere.

  Detection reads storage slots and bytecode rather than an ABI or a verified
  source, which is what makes it work on an unverified contract.

  Background:
    Given an empty configuration directory
    And a profile "work" with chains:
      | name | chain_id | rpc_url                 | symbol |
      | solo | 31337    | http://127.0.0.1:{stub} | ETH    |

  Rule: Seven cases are detected from storage slots and bytecode (REQ-105)

    @REQ-105
    Scenario Outline: Each detected type has a short label
      Given the address 0x0000000000000000000000000000000000000001 is <situation>
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -s -c solo -p work"
      Then the "Proxy type" cell reads "<label>"

      Examples:
        | situation                                                | label             |
        | an EIP-1967 proxy with a non-empty admin slot            | transparent proxy |
        | an EIP-1967 proxy with an empty admin slot               | UUPS proxy        |
        | an EIP-1967 proxy with a beacon slot                     | beacon proxy      |
        | bytecode matching the EIP-1167 or EIP-7511 clone pattern | minimal clone     |
        | a contract exposing implementation() as a beacon         | beacon contract   |
        | bytecode matching the ProxyAdmin heuristic               | ProxyAdmin        |
        | a contract with none of the above                        | not a proxy       |

    @REQ-105
    Scenario: Detection needs no ABI and no verified source
      Given the address holds unverified bytecode with an EIP-1967 implementation slot
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -c solo -p work"
      Then the type is detected
      And no explorer is consulted to detect it

  Rule: Each type reports the fields relevant to it, and an absent field reads n/a (REQ-106)

    @REQ-106
    Scenario Outline: The reported fields follow the detected type
      Given the address 0x0000000000000000000000000000000000000001 is a <type>
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -c solo -p work"
      Then the report carries "<fields>"

      Examples:
        | type              | fields                                                       |
        | transparent proxy | implementation, ProxyAdmin, admin owner, proxy owner()       |
        | UUPS proxy        | implementation, proxy owner()                                |
        | beacon proxy      | beacon, beacon owner, beacon.implementation(), proxy owner() |
        | minimal clone     | the embedded implementation                                  |
        | beacon contract   | its implementation and its owner                             |
        | ProxyAdmin        | its owner and the proxy it manages                           |
        | not a proxy       | owner(), when the contract exposes one                       |

    @REQ-106
    Scenario: An absent field is normal rather than an error
      Given a transparent proxy whose proxy contract exposes no owner()
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -c solo -p work"
      Then the "Proxy owner()" line reads "n/a"
      And the exit code is 0

  Rule: An admin that holds no code is flagged as an externally owned account (REQ-107)

    @REQ-107
    Scenario Outline: The admin line says which kind of admin it found
      Given a transparent proxy whose admin address <holds_code>
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -c solo -p work"
      Then the admin line carries "<annotation>"

      Examples:
        | holds_code    | annotation                                     |
        | holds no code | (EOA - upgrades sent directly by this account) |
        | holds code    | (ProxyAdmin contract)                          |

  Rule: The short form skips owner lookups and the ProxyAdmin trace (REQ-108)

    @REQ-108
    Scenario: -s is fast enough to scan every chain in the profile
      Given a profile "wide" with 14 chains
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -s -p wide"
      Then the columns are "Chain, Chain ID, Proxy type"
      And no owner() call is issued
      And no explorer lookup is attempted

  Rule: --full adds diagnostics read from the chain (REQ-109)

    @REQ-109
    Scenario: The extra fields appear under --full and not otherwise
      Given a UUPS proxy at 0x0000000000000000000000000000000000000001
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the report adds:
        | bytecode size                              |
        | the ProxyAdmin UPGRADE_INTERFACE_VERSION() |
        | the ERC-1822 proxiableUUID() check         |
        | initialization state                       |
        | owner classification                       |
        | pendingOwner() and paused() where present  |
        | a non-zero native balance                  |
      And the same command without "--full" carries none of them

    @REQ-109
    Scenario: The initialization line names where it read the answer
      Given a proxy whose initialization state is read from the OpenZeppelin v4 slot-0 heuristic
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the initialization line carries "(OZ v4 layout, heuristic)"

    @REQ-109
    Scenario: A balance is named in the chain's own token
      Given a profile "work" whose chain "solo" sets "symbol: BNB"
      And the address holds a non-zero native balance
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the balance line names "BNB"

  Rule: --full reports the implementation codehash and compares it across chains (REQ-110)

    @REQ-110
    Scenario: Each chain reports its own implementation codehash
      Given a UUPS proxy on two chains
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work"
      Then each chain carries an "Impl codehash:" line

    @REQ-110
    Scenario Outline: The comparison says whether the bytecode is the same everywhere
      Given a UUPS proxy on <n> chains whose implementations are <sameness>
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work"
      Then standard output contains "<report>"

      Examples:
        | n | sameness  | report                                                      |
        | 3 | identical | Implementation bytecode is identical on all 3 chains        |
        | 3 | different | Implementation bytecode DIFFERS across chains (2 variants): |

    @REQ-110
    # OQ-3: the documentation states the comparison unconditionally, while the
    # implementation skips it unless two chains produced a codehash. This
    # scenario states the precondition that a human still has to rule on, and is
    # the reason REQ-110 is the specification's one [Inferred] disagreement.
    Scenario: A single-chain run has nothing to compare
      Given a UUPS proxy on one chain
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the per-chain "Impl codehash:" line is present
      And the cross-chain comparison is absent

  Rule: --full adds three fields read from a block explorer (REQ-111)

    @REQ-111
    Scenario: The explorer-backed fields appear when a source answers
      Given a working explorer key is configured
      And a UUPS proxy at 0x0000000000000000000000000000000000000001
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the report carries the verified implementation name
      And the report carries the upgrade history from "Upgraded" events
      And the report carries the creation information

    @REQ-111 @REQ-131
    Scenario: They are absent when no source is configured, and the note explains why
      Given no explorer key is configured
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c solo -p work"
      Then the three explorer-backed fields are absent
      And standard error carries the skipped-lookup note

  Rule: The ProxyAdmin trace runs without --full, and is skipped only by -s (REQ-112)

    @REQ-112
    Scenario: Inspecting a ProxyAdmin finds the proxy it manages, in the default mode
      Given the address 0x0000000000000000000000000000000000000001 is a ProxyAdmin contract
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -c solo -p work"
      Then the trace to the managed proxy is attempted
      And an explorer lookup is performed, even without "--full"

    @REQ-112 @REQ-108
    Scenario: The short form skips it
      Given the address 0x0000000000000000000000000000000000000001 is a ProxyAdmin contract
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -s -c solo -p work"
      Then no trace is attempted

  Rule: A read command exits 1 only on an invalid address or option combination (REQ-124)

    @REQ-124
    Scenario Outline: A per-chain failure is data for the three read commands
      Given a profile "work" containing:
        """
        chains:
          down:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
        """
      When I run "evm contract <command> 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the row for "down" carries an error

      Examples:
        | command    |
        | owner      |
        | code       |
        | proxy-info |

    @REQ-124
    Scenario Outline: Only validation stops a read command
      When I run "evm contract <invocation> -p work"
      Then the exit code is 1

      Examples:
        | invocation                                                      |
        | owner notanaddress                                              |
        | code 0x0000000000000000000000000000000000000001 --full          |
        | proxy-info 0x0000000000000000000000000000000000000001 -s --full |
