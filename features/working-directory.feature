# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 6

Feature: Current working directory behaviour
  An operator runs the same command from a repository checkout, from a
  deployment directory, and from their home directory, and needs to know which
  of the three answers changes.

  Three things depend on where the command runs: the ./.env file, a relative -p
  path, and a relative configuration directory. The configuration directory
  itself does not, once it has resolved to an absolute path — which is why the
  same profile is reachable from anywhere.

  Background:
    Given an empty configuration directory

  Rule: ./.env is read from the directory the command runs in (REQ-012)

    @REQ-012
    Scenario: A key in the local .env is found when the command runs beside it
      Given the file "{root}/project/.env" declares DEPLOYER_PK as the operator's private key
      When I run "evm wallet address DEPLOYER_PK" from "{root}/project"
      Then the exit code is 0
      And standard output is the operator's checksummed address

    @REQ-012
    Scenario: The same command one directory away does not find it
      Given the file "{root}/project/.env" declares DEPLOYER_PK as the operator's private key
      When I run "evm wallet address DEPLOYER_PK" from "{root}/elsewhere"
      Then the exit code is 1
      And standard error is exactly "key argument is neither a hex key nor a set environment variable: DEPLOYER_PK"

  Rule: A -p value containing a slash is a path, resolved against the working directory (REQ-023)

    @REQ-023
    Scenario: A profile committed to a repository is usable without installing it
      Given a profile file "{root}/project/ops/chains.yaml" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain list -p ops/chains.yaml --json" from "{root}/project"
      Then the exit code is 0
      And the reported path is "{root}/project/ops/chains.yaml"

    @REQ-023
    Scenario: The same file reached from inside its own directory
      Given a profile file "{root}/project/ops/chains.yaml" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain list -p ./chains.yaml --json" from "{root}/project/ops"
      Then the reported path is "{root}/project/ops/chains.yaml"

    @REQ-023 @REQ-024
    Scenario: A path is not held to the profile-name pattern
      Given a profile file "{root}/project/ops/my chains.yaml" with no chains
      When I run "evm chain list -p './ops/my chains.yaml'" from "{root}/project"
      Then the exit code is 0

  Rule: profile clone accepts a path as its source (REQ-043)

    @REQ-043
    Scenario: A chain list in a repository becomes a local profile in one command
      Given a profile file "{root}/project/ops/chains.yaml" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm profile clone ./ops/chains.yaml team" from "{root}/project"
      Then the exit code is 0
      And the file "{config}/profiles/team.yaml" is byte-identical to "{root}/project/ops/chains.yaml"

  Rule: An absolute configuration directory is the same from every working directory (REQ-010)

    @REQ-010
    Scenario Outline: The same profile resolves from three different places
      Given a profile "alpha" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain list -p alpha --json" from "<directory>"
      Then the reported path is "{config}/profiles/alpha.yaml"

      Examples:
        | directory        |
        | {root}/project   |
        | {root}/elsewhere |
        | {root}/home      |

  Rule: Every write lands under the configuration directory or the explicit -p path (REQ-016)

    @REQ-016
    Scenario: A write through a relative -p lands beside the caller
      Given a profile file "{root}/project/out.yaml" with no chains
      When I run "evm chain set base http://127.0.0.1:8545 --chain-id 8453 --no-verify -p ./out.yaml" from "{root}/project"
      Then the exit code is 0
      And standard output contains "Added base to {root}/project/out.yaml"
      And the file "{root}/project/out.yaml" holds a chain "base" with chain id 8453
      And the configuration directory is still empty

    @REQ-036
    Scenario: A file written through -p is left owner-only, whatever it was before
      Given a profile file "{root}/project/out.yaml" with no chains, at mode 0644
      When I run "evm chain set base http://127.0.0.1:8545 --chain-id 8453 --no-verify -p ./out.yaml" from "{root}/project"
      Then the file "{root}/project/out.yaml" has mode 0600

  Rule: Nothing outside those two places is created (REQ-138)

    @REQ-138
    Scenario Outline: An ordinary command leaves the working directory as it found it
      When I run "evm <command>" from "{root}/project"
      Then the directory "{root}/project" contains nothing

      Examples:
        | command                                                     |
        | --version                                                   |
        | chain list                                                  |
        | profile list                                                |
        | profile create alpha                                        |
        | chain set zz http://127.0.0.1:8545 --chain-id 1 --no-verify |
        | wallet generate                                             |

    @REQ-138
    Scenario: After any sequence of commands the configuration directory holds only its three artefacts
      When I run a sequence of profile, chain and explorer commands
      Then the configuration directory holds only:
        | profiles/*.yaml   |
        | profiles/.default |
        | .env              |
      And no cache, log, or history file is present
