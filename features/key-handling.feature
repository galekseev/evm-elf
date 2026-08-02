# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, stories 1 and 5

Feature: Signing key handling
  An operator hands the CLI a private key, or the name of a variable holding
  one, and needs to know what becomes of it.

  The guarantees here are what bound everything the operator still has to
  protect themselves. They are stated as prohibitions, which makes them awkward
  to test and important to write down: a key must not reach a file, a table
  cell, a JSON field, or an outbound request.

  Background:
    Given an empty configuration directory

  Rule: No profile field holds a private key (REQ-034)

    @REQ-034
    Scenario: The writable surface of a profile has nowhere to put one
      Given a profile "work" using all six chain fields and an "explorers" section
      When I run "evm chain list -p work" and "evm explorer list -p work"
      Then no field of either is read as key material by any command
      And the only routes key material takes into the CLI are:
        | --private-key               |
        | the wallet address argument |
        | the wallet balance argument |

    @REQ-029 @REQ-034
    Scenario: A hand-added key field rejects the profile rather than being used
      Given a profile "work" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            private_key: 0x0000000000000000000000000000000000000000000000000000000000000001
        """
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid profile: chain 'base' in {config}/profiles/work.yaml has unknown field 'private_key'"

  Rule: Keys are never written to a file (REQ-077)

    @REQ-077
    Scenario: Generating a wallet stores nothing
      When I run "evm wallet generate"
      Then the exit code is 0
      And the configuration directory is still empty
      And the working directory contains nothing

    @REQ-077 @REQ-138
    Scenario: A signing command writes no key anywhere on disk
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo -p work"
      Then no file under the configuration directory contains the private key
      And no file under the working directory contains the private key

  Rule: Keys are never printed, except by the command whose purpose is to print one (REQ-078)

    @REQ-078
    Scenario Outline: A command given a key reports the address it derived, not the key
      Given the environment variable "DEPLOYER_PK" holds the operator's private key
      And a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      When I run "evm <command> -p work"
      Then neither standard output nor standard error contains the private key
      And the signer is identified by its checksummed address

      Examples:
        | command                                                                                               |
        | wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo |
        | wallet set-nonce 40 --private-key DEPLOYER_PK -c solo                                                 |
        | wallet balance DEPLOYER_PK --no-usd                                                                   |

    @REQ-078
    Scenario: The same holds under --json
      Given the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet address DEPLOYER_PK --json"
      Then the JSON carries the address
      And the JSON does not carry the private key

    @REQ-078 @REQ-101
    Scenario: wallet generate prints both by design, and says they are shown once
      When I run "evm wallet generate"
      Then standard output carries a "Mnemonic:" line
      And standard output carries a "Private key:" line
      And standard output warns that they are shown only once

  Rule: Signing happens in this process, and only the signature leaves it (REQ-079, REQ-144)

    @REQ-079 @code-only
    Scenario: No RPC method carrying raw key material is ever issued
      Given a profile "work" with 1 funded chain
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo -p work --exec"
      Then the endpoint receives "eth_sendRawTransaction" carrying a signed transaction
      And no request carries the private key
      And no "eth_sendTransaction" or "personal_*" method is used

    @REQ-144 @code-only
    Scenario: A key exists only for the duration of the invocation
      Given the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run any signing command
      Then the key reaches no file, no log line, no table cell and no JSON field
      And it leaves the process only as a signature

  Rule: A key argument is resolved by shape, then by lookup (REQ-074, REQ-075)

    @REQ-074
    Scenario: A value shaped like a key is used as one, without consulting the environment
      Given the environment variable "0x0000000000000000000000000000000000000000000000000000000000000001" is not set
      When I run "evm wallet address 0x0000000000000000000000000000000000000000000000000000000000000001"
      Then the exit code is 0
      And standard output is "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"

    @REQ-075
    Scenario Outline: wallet balance takes an address, a key, or a variable naming either
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "WALLET" holds <variable_holds>
      When I run "evm wallet balance <argument> -p work --no-usd"
      Then the exit code is 0
      And standard output opens with "Wallet Balance: 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
      And no signing occurs

      Examples:
        | argument                                                           | variable_holds  |
        | 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf                         | nothing         |
        | 0x0000000000000000000000000000000000000000000000000000000000000001 | nothing         |
        | WALLET                                                             | the address     |
        | WALLET                                                             | the private key |

  Rule: A profile may hold a secret that is not a key, and the table masks it (REQ-048)

    @REQ-048 @REQ-036
    Scenario: A literal header key is protected on screen and on disk
      Given a profile "work" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
            headers:
              auth-key: supersecretvalue1234
        """
      When I run "evm chain list -p work"
      Then standard output shows "****1234"
      And standard output does not show "supersecretvalue1234"

    @REQ-048
    Scenario: A reference is not a secret, so revealing it reveals nothing
      Given a profile "work" whose chain "base" sets a header to "${BASE_KEY}"
      And the environment variable "BASE_KEY" is exported as "supersecretvalue1234"
      When I run "evm chain list -p work --reveal"
      Then standard output shows "${BASE_KEY}"
      And standard output does not show "supersecretvalue1234"

  Rule: There is no prompt, so the plan is the only confirmation step (REQ-135)

    @REQ-135
    Scenario: No command reads standard input
      When I run every command in this suite with data on standard input
      Then none of them reads it
      And none of them behaves differently for its presence

    @REQ-135 @REQ-090
    Scenario: An irreversible operation needs an explicit flag, never an answer
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --private-key DEPLOYER_PK -c solo -p work" with "yes" on standard input
      Then no transaction is broadcast
      And standard output tells the operator to re-run with "--exec"
