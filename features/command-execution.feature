# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 1

Feature: Successful command execution
  An operator runs a command that does what it was asked, against a profile that
  describes the chains it should reach.

  The two rules that shape the whole surface: a read fans out across every chain
  the profile names, and a command that can sign prints a plan instead of
  signing. Everything else in this file is an instance of one of them.

  Background:
    Given an empty configuration directory

  Rule: Five command groups and 21 subcommands exist under the binary evm (REQ-001)

    @REQ-001
    Scenario: The five groups are the whole surface
      When I run "evm --help"
      Then the exit code is 0
      And the command groups offered are:
        | wallet   |
        | contract |
        | chain    |
        | explorer |
        | profile  |

    @REQ-001
    Scenario Outline: Each group offers its documented subcommands
      When I run "evm <group> --help"
      Then the subcommands offered are "<subcommands>"

      Examples:
        | group    | subcommands                                                |
        | wallet   | balance, send, set-nonce, generate, address                |
        | contract | owner, proxy-info, code, transfer-ownership, proxy-upgrade |
        | chain    | list, set, remove                                          |
        | explorer | list, set, remove                                          |
        | profile  | list, create, clone, remove, set-default                   |

  Rule: A command that does what it was asked exits 0, with its result on standard output (REQ-005, REQ-006)

    @REQ-005 @REQ-006
    Scenario: A successful read writes its result to standard output and nothing to standard error
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      When I run "evm chain list -p work"
      Then the exit code is 0
      And standard error is empty
      And standard output names the profile "work" and its absolute path

  Rule: A read reaches every chain in the profile unless narrowed (REQ-068)

    @REQ-068
    Scenario Outline: Selection decides how many chains a read touches
      Given the configuration directory holds the bundled 14-chain profile
      When I run "evm contract code 0x0000000000000000000000000000000000000001 <selection>"
      Then the result carries <rows> chain rows

      Examples:
        | selection          | rows |
        |                    | 14   |
        | -c base,mainnet    | 2    |
        | -xc mainnet,zksync | 12   |

  Rule: A command that can sign prints a plan and sends nothing until --exec (REQ-090)

    @REQ-090 @REQ-094
    Scenario: A send without --exec reports what it would do, in the chain's own token
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | bsc  | 56       | http://127.0.0.1:{stub} | BNB    |
      And the endpoint "bsc" answers as a healthy node
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c bsc -p work"
      Then the exit code is 0
      And standard output contains "Wallet Send: 0.01 BNB"
      And standard output contains "[1/1] bsc: would send 0.01 BNB"
      And no transaction is broadcast

    @REQ-090
    Scenario: --exec belongs to the four signing commands and to no others
      When I run each of the other 17 subcommands with "--exec"
      Then each rejects it as an unknown option
      And each exits 1

  Rule: chain set reads the chain ID from the endpoint and inherits metadata by chain ID (REQ-051, REQ-054)

    @REQ-051 @REQ-054
    Scenario: Adding a chain fills in what the operator did not type
      Given a profile "work" with no chains
      And an endpoint reporting chain id 8453
      When I run "evm chain set base-backup {endpoint} -p work"
      Then the exit code is 0
      And the profile "work" gains a chain "base-backup" holding:
        | chain_id     | 8453     |
        | symbol       | ETH      |
        | coingecko_id | ethereum |

    @REQ-033
    Scenario: A second entry may point at a chain the profile already names
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And an endpoint reporting chain id 8453
      When I run "evm chain set base-backup {endpoint} -p work"
      Then the exit code is 0
      And the profile "work" names both "base" and "base-backup" with chain id 8453
      And a fan-out read reaches both

  Rule: Profile lifecycle commands report the absolute path they acted on (REQ-013, REQ-041, REQ-043, REQ-045)

    @REQ-041
    Scenario: Creating a profile copies the bundled chain list and names what it wrote
      When I run "evm profile create myproject"
      Then the exit code is 0
      And the file "{config}/profiles/myproject.yaml" exists
      And standard output contains "14 chains from the bundled profile: arbitrum, avax, base, bsc, xdai, linea, mainnet, optimistic, matic, sepolia, sonic, unichain, zksync, robinhood"

    @REQ-041
    Scenario: An empty profile says how to fill it
      When I run "evm profile create myproject --empty"
      Then the exit code is 0
      And standard output contains "empty — add chains with: evm chain set <chain> <rpc-url>"

    @REQ-043 @REQ-037
    Scenario: Cloning copies a profile byte for byte
      Given a profile "alpha" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm profile clone alpha team"
      Then the exit code is 0
      And the file "{config}/profiles/team.yaml" is byte-identical to "{config}/profiles/alpha.yaml"

  Rule: An edit rewrites one entry and preserves the rest of the file (REQ-037)

    @REQ-037 @REQ-055
    Scenario: A comment between entries survives an edit to a neighbour
      Given a profile "commented" containing:
        """
        # Chains for the ops deployment
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            symbol: ETH

          # kept for the migration, remove after Q3
          bsc:
            chain_id: 56
            rpc_url: https://bsc-dataseed.com
            symbol: BNB
        """
      When I run "evm chain set base --symbol ETH2 -p commented"
      Then the exit code is 0
      And the comment "# Chains for the ops deployment" is still the first line
      And the comment "# kept for the migration, remove after Q3" is still above "bsc:"
      And the entry for "bsc" is byte-unchanged

    @REQ-037
    # REQ-037 was amended on 2026-08-01: it previously promised the file's
    # comments without qualification. A field is replaced rather than patched,
    # and a trailing comment belongs to the value being replaced, so it goes
    # with it. A comment on its own line above the entry survives.
    Scenario: A trailing comment on a rewritten field does not survive
      Given a profile "commented" containing:
        """
        chains:
          base:
            # the public endpoint
            chain_id: 8453
            rpc_url: https://mainnet.base.org  # rate-limited
            symbol: ETH
        """
      When I run "evm chain set base https://base.example.com --chain-id 8453 --no-verify -p commented"
      Then the exit code is 0
      And the standalone comment "# the public endpoint" is still above "chain_id"
      But the trailing comment "# rate-limited" is gone with the value it annotated

    @REQ-037 @REQ-055
    # REQ-037 was amended on 2026-08-01: clearing a field deletes the key, so
    # setting it again appends it. Field order within an entry carries no
    # meaning, and the file stays valid and readable either way.
    Scenario: Clearing a field and setting it again moves it to the end of the entry
      Given a profile "commented" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            symbol: ETH
            coingecko_id: ethereum
        """
      When I run "evm chain set base --symbol '' -p commented"
      And I run "evm chain set base --symbol ETH -p commented"
      Then the keys of the entry "base" are in the order:
        | chain_id     |
        | rpc_url      |
        | coingecko_id |
        | symbol       |
      And the entry still parses with every field intact

    @REQ-037
    # The explorers section is created above chains, deliberately: it is two
    # lines and should not sit below fourteen of them. Which comments survive
    # that is the YAML comment model rather than a choice, and a blank line is
    # what decides it. `profile create --empty` gained one on 2026-08-01 so the
    # file the CLI writes itself behaves like the bundled profile.
    Scenario: A file header separated by a blank line stays at the top
      Given a profile "commented" containing:
        """
        # Ops profile — do not commit

        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
        """
      When I run "evm explorer set etherscan somekey --no-verify -p commented"
      Then the exit code is 0
      And the comment "# Ops profile — do not commit" is still the first line
      And the "explorers" section appears beneath it, above "chains"

    @REQ-037
    Scenario: A comment flush against chains belongs to chains and moves with it
      Given a profile "commented" containing:
        """
        # Chains for the ops deployment
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
        """
      When I run "evm explorer set etherscan somekey --no-verify -p commented"
      Then the exit code is 0
      And the "explorers" section is the first thing in the file
      And the comment "# Chains for the ops deployment" is still directly above "chains"

    @REQ-037 @REQ-041
    Scenario: The profile the CLI writes itself keeps its header
      When I run "evm profile create scratch --empty"
      And I run "evm explorer set etherscan somekey --no-verify -p scratch"
      Then the exit code is 0
      And the file "{config}/profiles/scratch.yaml" still opens with its header comment

    @REQ-013 @REQ-045
    Scenario: Setting the default writes the pointer and reports where it points
      Given a profile "myproject" with no chains
      When I run "evm profile set-default myproject"
      Then the exit code is 0
      And the file "{config}/profiles/.default" contains "myproject"
      And standard output contains "Default profile is now myproject"

    @REQ-044
    Scenario: Removing a profile that is not in use deletes it without asking
      Given a profile "spare" with no chains
      And the default pointer names "other"
      When I run "evm profile remove spare"
      Then the exit code is 0
      And the file "{config}/profiles/spare.yaml" is gone

  Rule: The two local-only wallet commands make no network request at all (REQ-101, REQ-102)

    @REQ-102
    Scenario: An address is derived from a key held in the environment
      Given the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet address DEPLOYER_PK"
      Then the exit code is 0
      And standard output is the operator's checksummed address
      And no outbound request is made

    @REQ-101
    Scenario Outline: Generating a wallet produces a mnemonic of the requested length
      When I run "evm wallet generate <words>"
      Then the exit code is 0
      And standard output carries an address, a mnemonic of <length> words, and a private key
      And standard output warns that the secrets are shown only once
      And no outbound request is made

      Examples:
        | words      | length |
        |            | 12     |
        | --words 12 | 12     |
        | --words 24 | 24     |

  Rule: Each read command has a fixed column set (REQ-047, REQ-060, REQ-080, REQ-104, REQ-114)

    @REQ-080 @REQ-081
    Scenario: A balance read reports the balance, the pending nonce, and a status per chain
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |              |
      And the endpoint "solo" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then the exit code is 0
      And standard output opens with "Wallet Balance: 0x0000000000000000000000000000000000000001"
      And the columns are "Chain, Chain ID, Balance (Native), Token, Nonce, Status"
      And the "Nonce" cell holds the pending transaction count

    @REQ-082 @REQ-083
    Scenario: A balance worth less than a cent is not rounded away
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the price source values the holding at $0.004
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the "Value (USD)" cell reads "<$0.01"
      But a holding worth exactly zero prints a formatted zero

    @REQ-114
    Scenario: A code read reports the bytecode size and whether the address holds code
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" holds code at 0x0000000000000000000000000000000000000001
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the columns are "Chain, Chain ID, Code Size, Status"
      And the "Status" cell reads "deployed"

    @REQ-104
    Scenario: An ownership read reports one owner per chain
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers "owner()" with 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF
      When I run "evm contract owner 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the columns are "Chain, Chain ID, Owner"
      And the "Owner" cell reads "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF"

    @REQ-047
    Scenario: A chain list names the profile, then one row per chain
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain list -p work"
      Then the exit code is 0
      And the columns are "Chain, Chain ID, RPC URL, Token, Headers"

    @REQ-047
    Scenario: A profile with no chains says how to add one
      Given a profile "work" with no chains
      When I run "evm chain list -p work"
      Then the exit code is 0
      And standard output contains "No chains configured. Add one: evm chain set base <rpc-url>"

    @REQ-060 @REQ-020 @REQ-129
    Scenario: An explorer list shows both sources, their endpoints, and the order they are tried in
      Given a profile "work" with no chains
      When I run "evm explorer list -p work"
      Then the exit code is 0
      And standard output names both "etherscan" and "blockscout", whether or not the profile configures them
      And standard output names the endpoints:
        | etherscan  | https://api.etherscan.io/v2/api   |
        | blockscout | https://api.blockscout.com/v2/api |
      And each carries one of three key states: a "${VAR}" reference, a masked literal, or "not set"
      And standard output closes with "Tried in this order, after a chain that names its own explorer_api."

  Rule: A profile list reports what exists and which profile is in use (REQ-038, REQ-039)

    @REQ-038
    Scenario: Each profile appears once, with a chain count and a path
      Given a profile "alpha" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And a profile "beta" with no chains
      When I run "evm profile list"
      Then the exit code is 0
      And the row for "alpha" carries a chain count of 1 and its absolute path
      And the row for "beta" carries a chain count of 0 and its absolute path

    @REQ-039
    Scenario: Exactly one row is marked as the profile in use
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And the default pointer names "beta"
      When I run "evm profile list"
      Then exactly one row carries the "*" marker
      And that row is "beta"
      And the closing legend names "beta"
