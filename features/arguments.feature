# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 2

Feature: Invalid and missing arguments
  An operator mistypes an argument, omits a required one, or asks for two things
  that cannot both be meant.

  Every rejection here shares three properties: it happens before anything is
  written, it names what was received, and it prints one line without a stack
  trace. The exact wording matters because the troubleshooting reference is
  indexed by it.

  Background:
    Given an empty configuration directory

  Rule: Three option pairs are rejected by the parser, before any command body runs (REQ-008)

    @REQ-008
    Scenario Outline: Naming the same thing twice is refused with the parser's own wording
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm <command> -p work"
      Then the exit code is 1
      And standard error is exactly "<message>"
      And the profile "work" is unchanged

      Examples:
        | command                                                                                            | message                                                                                         |
        | wallet balance 0x0000000000000000000000000000000000000001 -c base -xc base                         | error: option '-xc, --exclude-chain <chains>' cannot be used with option '-c, --chain <chains>' |
        | wallet send 0x0000000000000000000000000000000000000001 --private-key PK --value 1 --all            | error: option '--value <amount>' cannot be used with option '--all'                             |
        | wallet send 0x0000000000000000000000000000000000000001 --private-key PK --value 1 --fee-buffer 1.2 | error: option '--fee-buffer <multiplier>' cannot be used with option '--value <amount>'         |

  Rule: A bare profile name matches the documented pattern on every route (REQ-024)

    @REQ-024
    Scenario: An invalid name given with -p is refused
      When I run "evm chain list -p 'bad name!'"
      Then the exit code is 1
      And standard error is exactly "Invalid profile name 'bad name!': use letters, digits, '.', '_' or '-'"

    @REQ-024
    Scenario: An invalid name arriving in the environment is refused the same way
      Given the environment variable "EVM_ELF_PROFILE" is exported as "bad name!"
      When I run "evm chain list"
      Then the exit code is 1
      And standard error is exactly "Invalid profile name 'bad name!': use letters, digits, '.', '_' or '-'"

    @REQ-024
    # Resolved in the code on 2026-08-01: the path form of REQ-023 had applied to
    # any value containing a slash, whichever route it arrived by, so a pointer or
    # an environment variable could read a file outside the profiles directory.
    Scenario: A name arriving from the pointer file meets the pattern too
      Given the default pointer names "../outside"
      When I run "evm chain list"
      Then the exit code is 1
      And standard error is exactly "Invalid profile name '../outside': use letters, digits, '.', '_' or '-'"
      And no file outside the profiles directory is read

    @REQ-024 @REQ-023
    Scenario: The same value through -p is a path, which is the route that carries one
      Given a profile file "{root}/outside/chains.yaml" with no chains
      When I run "evm chain list --json -p {root}/outside/chains.yaml"
      Then the exit code is 0
      And the reported path is "{root}/outside/chains.yaml"

    @REQ-024
    Scenario: And through set-default it is a name, as it always was
      When I run "evm profile set-default {root}/outside/chains.yaml"
      Then the exit code is 1
      And standard error names it as an invalid profile name

  Rule: Key resolution fails with one of exactly four messages, each naming what it received (REQ-076)

    @REQ-076
    Scenario: A --private-key that is neither a key nor a set variable
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm wallet set-nonce 5 --private-key NOPE -p work"
      Then the exit code is 1
      And standard error is exactly "--private-key is neither a hex key nor a set environment variable: NOPE"

    @REQ-076
    Scenario: The same failure on wallet address names the argument rather than the option
      When I run "evm wallet address NOPE"
      Then the exit code is 1
      And standard error is exactly "key argument is neither a hex key nor a set environment variable: NOPE"

    @REQ-076 @REQ-075
    Scenario: The wallet balance argument accepts three forms, and says so when given a fourth
      When I run "evm wallet balance NOPE"
      Then the exit code is 1
      And standard error is exactly "Not an address, a private key, or a set environment variable: NOPE"

    @REQ-076
    Scenario: A variable that is set but holds something else
      Given the environment variable "DEPLOYER_PK" is exported as "hello"
      When I run "evm wallet balance DEPLOYER_PK"
      Then the exit code is 1
      And standard error is exactly "Env variable DEPLOYER_PK holds neither an address nor a 32-byte hex private key"

    @REQ-074
    Scenario: A malformed hex key is refused as a key rather than looked up as a variable
      When I run "evm wallet address 0x00"
      Then the exit code is 1
      And standard error names what was received

  Rule: Each command validates its own arguments with a documented message (REQ-087, REQ-089, REQ-097, REQ-101, REQ-104, REQ-120)

    @REQ-087
    Scenario Outline: An amount is a decimal, an ether amount, or a wei amount
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value <amount> --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is <code>

      Examples:
        | amount               | code |
        | 0.01                 | 0    |
        | 0.01ether            | 0    |
        | 10000000000000000wei | 0    |
        | abc                  | 1    |

    @REQ-087
    Scenario: An amount in no accepted form names itself in the message
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value abc --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid --value: abc"

    @REQ-089
    Scenario Outline: The gas reserve multiplier is a number of at least one
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --fee-buffer <value> --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid --fee-buffer: <value> (must be a number >= 1)"

      Examples:
        | value |
        | 0.5   |
        | abc   |

    @REQ-097
    Scenario Outline: A target nonce is a non-negative integer
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet set-nonce <target> --private-key DEPLOYER_PK -p work"
      Then the exit code is 1
      And standard error is exactly "Target nonce must be a non-negative integer, got: <target>"

      Examples:
        | target |
        | abc    |
        | 1.5    |

    @REQ-097
    Scenario: A negative target is read as an option before the command ever sees it
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet set-nonce -3 --private-key DEPLOYER_PK -p work"
      Then the exit code is 1
      And standard error is exactly "error: unknown option '-3'"

    @REQ-101
    Scenario: A mnemonic is 12 words or 24, and nothing else
      When I run "evm wallet generate --words 18"
      Then the exit code is 1
      And standard error is exactly "--words must be 12 or 24, got: 18"
      And no wallet is generated

    @REQ-104
    Scenario Outline: A contract command refuses an address it cannot parse
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm contract <command> notanaddress -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid Ethereum address: notanaddress"
      And no chain is reached

      Examples:
        | command    |
        | owner      |
        | code       |
        | proxy-info |

    @REQ-120
    Scenario: Upgrade calldata is a 0x-prefixed hex string
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm contract proxy-upgrade 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 --data deadbeef --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid --data: must be a 0x-prefixed hex string, got: deadbeef"

    @REQ-056
    Scenario Outline: A header is a name and a value separated by a colon
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain set base -H '<header>' -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid --header '<header>': expected <name>:<value>"
      # `<name>:<value>` is the CLI's own literal text, not a placeholder.
      And the profile "work" is unchanged

      Examples:
        | header   |
        | nocolon  |
        | :novalue |
        | noname:  |

    @REQ-061
    Scenario: An explorer name outside the two known sources is refused
      Given a profile "work" with no chains
      When I run "evm explorer set etherscn somekey -p work"
      Then the exit code is 1
      And standard error is exactly "Unknown explorer 'etherscn': known explorers are etherscan, blockscout"
      And the profile "work" is unchanged

    @REQ-067
    Scenario: An empty key is refused, and the message names the way to clear one
      Given a profile "work" with no chains
      When I run "evm explorer set etherscan '' -p work"
      Then the exit code is 1
      And standard error is exactly "Empty API key for 'etherscan': pass a key, or remove it with evm explorer remove etherscan"

  Rule: Option combinations that cannot both be meant are refused, naming the actual problem (REQ-053, REQ-073, REQ-086, REQ-093, REQ-113, REQ-115)

    @REQ-053
    Scenario: Skipping the chain-id check requires supplying the chain id
      Given a profile "work" with no chains
      When I run "evm chain set local http://127.0.0.1:8545 --no-verify -p work"
      Then the exit code is 1
      And standard error is exactly "--no-verify needs --chain-id, since the chain id cannot be read from the RPC"
      And the profile "work" is unchanged

    @REQ-073
    Scenario Outline: A single-chain write refuses a selection naming two chains
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
        | bsc  | 56       | https://bsc-dataseed.com | BNB    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm contract <command> <arguments> --private-key DEPLOYER_PK -c base,bsc -p work"
      Then the exit code is 1
      And standard error is exactly "<command> requires exactly one chain (-c <chain>)"
      # `-c <chain>` is the CLI's own literal text, not a placeholder.

      Examples:
        | command            | arguments                                                                             |
        | transfer-ownership | 0x0000000000000000000000000000000000000001 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF |
        | proxy-upgrade      | 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 |

    @REQ-073
    Scenario: A single-chain write refuses to run without a selection at all
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm contract transfer-ownership 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000002 --private-key DEPLOYER_PK -p work"
      Then the exit code is 1
      And standard error reports a missing required option

    @REQ-086
    Scenario: A send needs to be told how much to send
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is 1
      And standard error is exactly "send requires either --value <amount> or --all"

    @REQ-093
    Scenario: Declining to wait means nothing when nothing is being sent
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --no-wait --private-key DEPLOYER_PK -c base -p work"
      Then the exit code is 1
      And standard error is exactly "--no-wait has no effect without --exec: a plan sends nothing"

    @REQ-113
    Scenario: The short and full forms of proxy-info exclude each other
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -s --full -p work"
      Then the exit code is 1
      And standard error is exactly "--short and --full are mutually exclusive"

    @REQ-115
    Scenario: Printing full bytecode needs one chain to print it from
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
        | bsc  | 56       | https://bsc-dataseed.com | BNB    |
      When I run "evm contract code 0x0000000000000000000000000000000000000001 --full -p work"
      Then the exit code is 1
      And standard error is exactly "--full requires exactly one chain (use -c <chain>)"

    @REQ-096
    Scenario: A send against a profile that names no chains says so
      Given a profile "work" with no chains
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -p work"
      Then the exit code is 1
      And standard error is exactly "No chains selected"

  Rule: A missing required argument or option is a parser error, never a prompt (REQ-135)

    @REQ-135
    Scenario: A missing argument fails rather than asking for it
      When I run "evm wallet address" with "0x0000000000000000000000000000000000000000000000000000000000000001" on standard input
      Then the exit code is 1
      And standard error is exactly "error: missing required argument 'private-key'"
      And standard input is not read

    @REQ-135
    Scenario: A missing required option fails rather than asking for it
      Given a profile "work" with no chains
      When I run "evm wallet set-nonce 3 -p work" with "yes" on standard input
      Then the exit code is 1
      And standard error is exactly "error: required option '--private-key <key>' not specified"
      And standard input is not read

  Rule: A failure prints its message alone, with no stack trace (REQ-009)

    @REQ-009
    Scenario: A rejected argument produces one line and no frames
      When I run "evm chain list -p neverexisted"
      Then the exit code is 1
      And standard error is a single line
      And standard error contains no "at " stack frame

    @REQ-005
    Scenario: No rejection produces an exit code other than 1
      When I run every invalid invocation in this feature
      Then each exit code is 1
