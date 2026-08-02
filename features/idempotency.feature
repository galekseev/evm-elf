# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 9

Feature: Repeating an operation
  An operator re-runs a command because a script retried, because they lost the
  output, or because they are not sure the first run took effect.

  The specification states idempotency per command rather than as one rule, so
  every scenario here names the requirement that makes its repeat safe. Two of
  them are deliberately not idempotent, and are specified as such so that nobody
  later "fixes" them: generating a wallet, and sending a transaction.

  # Q15: no requirement states idempotency as a system-wide rule. Each scenario
  # below rests on a requirement about one command. A new command could be
  # non-idempotent tomorrow without contradicting anything.

  Background:
    Given an empty configuration directory

  Rule: Seeding happens only when default.yaml is missing (REQ-015, REQ-146)

    @REQ-015
    Scenario: A second run neither recreates nor overwrites the seeded profile
      When I run "evm chain list"
      And I edit "{config}/profiles/default.yaml" by removing the chain "base"
      And I run "evm chain list" again
      Then the exit code is 0
      And the second run's standard error contains no "from the bundled default profile" notice
      And the profile "default" still does not name "base"

    @REQ-146
    Scenario: An upgrade leaves every profile byte-unchanged
      Given a profile "myproject" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When the package is upgraded in place
      Then the profile "myproject" is byte-unchanged
      And the configuration directory is still present

  Rule: The bundled profile is never merged into a live one (REQ-014)

    @REQ-014
    Scenario: A chain removed stays removed however many reads follow
      When I run "evm chain list"
      And I run "evm chain remove base"
      And I run "evm chain list" three more times
      Then no run restores "base"
      And the profile "default" names 13 chains

    @REQ-014 @REQ-054
    Scenario: The bundle is still consulted for metadata, which is not the same as merging
      Given a profile "work" with no chains
      And an endpoint reporting chain id 8453
      When I run "evm chain set base-backup {endpoint} -p work"
      Then the profile "work" holds exactly one chain
      And that chain carries "symbol: ETH" and "coingecko_id: ethereum" from the bundle

  Rule: A creating command run twice fails the second time and leaves the first result alone (REQ-042, REQ-043)

    @REQ-042 @REQ-046
    Scenario: Creating the same profile twice
      When I run "evm profile create myproject"
      And I run "evm profile create myproject" again
      Then the first exit code is 0
      And the second exit code is 1
      And the second run's standard error is exactly "Profile already exists: {config}/profiles/myproject.yaml"
      And the profile "myproject" is byte-identical to what the first run wrote

    @REQ-043 @REQ-046
    Scenario: Cloning to the same target twice
      Given a profile "alpha" with no chains
      When I run "evm profile clone alpha team"
      And I run "evm profile clone alpha team" again
      Then the second exit code is 1
      And the second run's standard error is exactly "Profile already exists: {config}/profiles/team.yaml (pass --force to overwrite)"

    @REQ-043
    Scenario: --force makes the clone repeatable, and the result is the same each time
      Given a profile "alpha" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm profile clone alpha team --force" twice
      Then both exit codes are 0
      And the file "{config}/profiles/team.yaml" is byte-identical to "{config}/profiles/alpha.yaml"

  Rule: An editing command run twice with the same arguments leaves the same file (REQ-037, REQ-055, REQ-056)

    @REQ-055 @REQ-037
    Scenario: Setting a chain twice with identical arguments
      Given a profile "work" with no chains
      When I run "evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p work" twice
      Then both exit codes are 0
      And the profile after the second run is byte-identical to the profile after the first

    @REQ-056
    Scenario: Adding the same header twice changes nothing the second time
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain set base -H 'auth-key:topsecret' -p work" twice
      Then the profile after the second run is byte-identical to the profile after the first
      And the chain "base" carries exactly one "auth-key" header

    @REQ-056
    Scenario: Removing a header that is already gone is not an error
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm chain set base --remove-header auth-key -p work" twice
      Then both exit codes are 0
      And the chain "base" carries no "headers" key

    @REQ-064 @REQ-065
    Scenario: Setting the same explorer key twice reports the second as a replacement
      Given a profile "work" with no chains
      When I run "evm explorer set etherscan somekey --no-verify -p work"
      And I run "evm explorer set etherscan somekey --no-verify -p work" again
      Then both exit codes are 0
      And the first run reports "Added etherscan"
      And the second run reports "Updated etherscan"
      And the profile after the second run is byte-identical to the profile after the first

  Rule: A removing command run twice fails the second time, listing what remains (REQ-058, REQ-066)

    @REQ-058 @REQ-059
    Scenario: Removing the same chain twice
      Given a profile "work" with chains:
        | name | chain_id | rpc_url               | symbol |
        | solo | 31337    | http://127.0.0.1:8545 | ETH    |
      When I run "evm chain remove solo -p work"
      And I run "evm chain remove solo -p work" again
      Then the first exit code is 0
      And the second exit code is 1
      And the second run's standard error is exactly "Chain 'solo' is not in {config}/profiles/work.yaml (configured: none)"

    @REQ-066 @REQ-067
    Scenario: Removing the same explorer twice
      Given a profile "work" whose "explorers" section sets etherscan
      When I run "evm explorer remove etherscan -p work"
      And I run "evm explorer remove etherscan -p work" again
      Then the first exit code is 0
      And the second exit code is 1
      And the second run's standard error is exactly "Explorer 'etherscan' is not configured in {config}/profiles/work.yaml (configured: none)"

    @REQ-044 @REQ-046
    Scenario: Removing the same profile twice
      Given a profile "spare" with no chains
      And the default pointer names "other"
      When I run "evm profile remove spare"
      And I run "evm profile remove spare" again
      Then the first exit code is 0
      And the second exit code is 1
      And the second run's standard error names the profile as not found

  Rule: set-default run twice with the same name leaves the same pointer (REQ-045)

    @REQ-045
    Scenario: Only a genuine change reports a previous value
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      When I run "evm profile set-default alpha"
      And I run "evm profile set-default alpha" again
      Then both exit codes are 0
      And both runs print "Default profile is now alpha"
      And neither run prints a "was" line
      And the file "{config}/profiles/.default" contains "alpha"

    @REQ-045
    Scenario: Changing the pointer does report what it was
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And the default pointer names "alpha"
      When I run "evm profile set-default beta"
      Then standard output contains "was alpha"

  Rule: A dry run is repeatable and changes nothing (REQ-090, REQ-091)

    @REQ-090
    Scenario: Three identical plans, no transaction, no file
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo -p work" three times
      Then all three exit codes are 0
      And all three plans are identical
      And no transaction is broadcast
      And the configuration directory is unchanged

    @REQ-091
    Scenario: A --value plan does not read balances, so an unfunded address still plans a send
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" reports a zero balance
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo -p work"
      Then the row for "solo" reads "will send"

  Rule: set-nonce skips a chain already at or above the target (REQ-098)

    @REQ-098
    Scenario Outline: Re-running the plan after a successful alignment sends nothing
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" reports a transaction count of <current>
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet set-nonce <target> --private-key DEPLOYER_PK -c solo -p work"
      Then the exit code is 0
      And the row for "solo" reads "<status>"
      And no transaction is broadcast

      Examples:
        | current | target | status                   |
        | 40      | 40     | skip (already at target) |
        | 41      | 40     | skip (above target)      |

    @REQ-100 @code-only
    Scenario: After a confirmation timeout the safe operation is the plan, not another --exec
      Given a run of "set-nonce --exec" that timed out waiting for confirmation
      When I run the same command without "--exec"
      Then the plan reports the current nonce as read from the chain
      And no further transaction is sent

  Rule: Two operations are deliberately not idempotent (REQ-101, REQ-135)

    @REQ-101
    Scenario: Generating a wallet twice produces two different wallets
      When I run "evm wallet generate --json" twice
      Then both exit codes are 0
      And the two addresses differ
      And the two mnemonics differ

    @REQ-135 @REQ-090 @code-only
    Scenario: Sending twice sends twice, because --exec has no memory of the first run
      Given a profile "work" with 1 funded chain
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c solo -p work --exec" twice
      Then two transactions are broadcast
      And nothing prompts, warns, or deduplicates between the two runs

  Rule: A rewrite tightens permissions every time (REQ-036)

    @REQ-036
    Scenario: A profile loosened between runs is tightened again by the next write
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I set the mode of "{config}/profiles/work.yaml" to 0644
      And I run "evm chain set base --symbol ETH -p work"
      Then the file "{config}/profiles/work.yaml" has mode 0600
