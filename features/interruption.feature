# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 10

Feature: Interrupted operations
  An operator presses Ctrl-C on a fan-out that is taking too long, a supervisor
  sends SIGTERM, or a command gives up on an endpoint by itself.

  The property that matters is the same in all three cases: an edit that did not
  finish must leave the profile exactly as it was. A profile is hand-tuned and
  there is no undo, so a half-written one would be worse than no edit at all.

  Background:
    Given an empty configuration directory

  Rule: An edit interrupted part-way cannot truncate a working profile (REQ-035)

    @REQ-035
    Scenario Outline: A signal during a verifying write leaves the profile as it was
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And an endpoint that accepts connections and never answers
      When I run "evm chain set hang {endpoint} -p work"
      And I send <signal> while it is waiting for the endpoint
      Then the profile "work" is byte-unchanged

      Examples:
        | signal  |
        | SIGINT  |
        | SIGTERM |

    @REQ-035
    Scenario: A signal after the endpoint answered still cannot leave a partial file
      Given a profile "work" with 14 chains
      And an endpoint reporting chain id 8453
      When I run "evm chain set base {endpoint} -p work"
      And the process is killed at any point during the run
      Then the profile "work" is either byte-unchanged or completely rewritten
      And it parses as a valid profile in both cases

  Rule: An interrupted run leaves no temporary file and no other state (REQ-035, REQ-138)

    @REQ-138
    Scenario: The profiles directory holds nothing the run created
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And an endpoint that accepts connections and never answers
      When I run "evm chain set hang {endpoint} -p work"
      And I send SIGINT while it is waiting for the endpoint
      Then the profiles directory holds only "work.yaml"

    @REQ-138
    Scenario: An interrupted read writes nothing and prints no partial table
      Given a profile "work" containing:
        """
        chains:
          hang:
            chain_id: 8453
            rpc_url: {silent endpoint}
        """
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      And I send SIGTERM while it is waiting for the endpoint
      Then standard output is empty
      And the profiles directory holds only "work.yaml"

  Rule: An interrupted run broadcasts nothing it had not already broadcast (REQ-090)

    @REQ-090
    Scenario: Interrupting a plan cannot send anything, because a plan sends nothing
      Given a profile "work" with chains:
        | name | chain_id | rpc_url           | symbol |
        | hang | 31337    | {silent endpoint} | ETH    |
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -c hang -p work"
      And I send SIGINT while it is waiting for the endpoint
      Then no transaction is broadcast

    @REQ-096 @code-only
    Scenario: Interrupting a fan-out send stops it where it stood
      Given a profile "work" with 3 funded chains
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --value 0.01 --private-key DEPLOYER_PK -p work --exec"
      And I send SIGINT after the first chain has been sent
      Then the chains not yet reached are not sent
      And the transaction already broadcast is not recalled

  Rule: A command abandons an external request at its own bound rather than hanging (REQ-136)

    @REQ-136 @REQ-051
    Scenario: The chain-id check gives up after five seconds
      Given a profile "work" with no chains
      And an endpoint that accepts connections and never answers
      When I run "evm chain set hang {endpoint} -p work"
      Then the exit code is 1
      And standard error is exactly:
        """
        Could not read the chain id from {endpoint}: no response in 5000ms
        Pass --no-verify --chain-id <id> to write the entry anyway.
        """
      And it gave up after 5 seconds and before 15
      And the profile "work" is byte-unchanged

    @REQ-136 @REQ-128
    Scenario: A price request that never answers is abandoned without failing the read
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the price service accepts connections and never answers
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the balance and nonce are reported
      And the "Value (USD)" column is empty
      And the run finishes within 5 seconds of the balances being read

    @REQ-136 @REQ-062 @code-only
    Scenario: The explorer key probe is bounded the same way
      Given a profile "work" with no chains
      And an explorer that accepts connections and never answers
      When I run "evm explorer set etherscan somekey -p work"
      Then the request is abandoned after 5 seconds
      And the profile "work" is byte-unchanged

  Rule: set-nonce polls for a bounded window, then reports the timeout (REQ-100, REQ-137)

    @REQ-137 @code-only
    Scenario: Polling stops at the target or at sixty seconds, whichever comes first
      Given a profile "work" with 1 chain whose nonce never advances
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet set-nonce 40 --private-key DEPLOYER_PK -c solo -p work --exec"
      Then the confirmed nonce is polled every 2 seconds
      And polling stops after 60 seconds

    @REQ-100 @code-only
    Scenario: A timeout is reported rather than retried
      Given a run of "set-nonce --exec" whose transactions do not confirm within the window
      Then the row reads "sent <n>, nonce <m> (timeout waiting for <target>)"
      And no further transaction is sent

  Rule: Exit codes govern normal termination; a signal ends the run without one (REQ-005)

    @REQ-005
    # REQ-005 was amended on 2026-08-01. It previously admitted only 0 and 1
    # without qualification, which a signal contradicts: nothing installs a
    # handler, so the process is terminated rather than exiting. The scope
    # limitation is now stated, and REQ-035 is what makes it harmless.
    Scenario Outline: An interrupted run is terminated by its signal, not by an exit code
      Given a profile "work" with no chains
      And an endpoint that accepts connections and never answers
      When I run "evm chain set hang {endpoint} -p work"
      And I send <signal> while it is waiting for the endpoint
      Then the process is reported as terminated by <signal>
      And no exit code is reported
      And the profiles directory is unchanged

      Examples:
        | signal  |
        | SIGINT  |
        | SIGTERM |

    @REQ-005
    Scenario: A run that reaches its own end uses one of the two codes
      Given a profile "work" with no chains
      When I run "evm chain list -p work"
      Then the exit code is 0
      And no signal is reported
