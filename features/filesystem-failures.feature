# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 7

Feature: Filesystem failures
  An operator's profile directory is read-only, a file is unreadable, or a
  previous run left something where a file should be.

  A profile is a hand-tuned list of endpoints, headers and keys, and there is no
  undo. So the rule throughout is that a command which cannot finish leaves the
  file exactly as it found it, and says so in one line.

  Background:
    Given an empty configuration directory

  Rule: Every profile write goes through a temporary file and a rename (REQ-035)

    @REQ-035
    Scenario: An interrupted or failed write cannot truncate a working profile
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the profiles directory is not writable
      When I run "evm chain set solo http://127.0.0.1:8545 --chain-id 31337 --no-verify -p work"
      Then the exit code is 1
      And the profile "work" is byte-unchanged

    @REQ-035 @REQ-138
    Scenario: A failed write leaves no temporary file behind
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the profiles directory is not writable
      When I run "evm chain set solo http://127.0.0.1:8545 --chain-id 31337 --no-verify -p work"
      Then the profiles directory holds only "work.yaml"

    @REQ-035
    Scenario: No partially written profile is ever observable
      Given a profile "work" with 14 chains
      When I run "evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p work"
      Then the profile "work" is valid YAML at every moment of the run
      And the profile "work" parses as a complete profile afterwards

  Rule: A refused write names the profile and the directory (REQ-147)

    @REQ-147
    # Added 2026-08-01. The atomic write of REQ-035 fails on a temporary file
    # that is unlinked before the operator sees the error, so reporting it sent
    # them to a path that no longer existed.
    Scenario Outline: Every write path reports a refusal the same way
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      And the profiles directory is not writable
      When I run "evm <command>"
      Then the exit code is 1
      And standard error is exactly:
        """
        Could not write {config}/profiles/<target>: permission denied. Nothing written.
        Check the directory: ls -ld {config}/profiles
        """
      And no message names a ".tmp" path
      And the profile "work" is byte-unchanged

      Examples:
        | command                                                                   | target     |
        | chain set solo http://127.0.0.1:8545 --chain-id 31337 --no-verify -p work | work.yaml  |
        | chain remove base -p work                                                 | work.yaml  |
        | explorer set etherscan somekey --no-verify -p work                        | work.yaml  |
        | profile create fresh --empty                                              | fresh.yaml |
        | profile clone work copy                                                   | copy.yaml  |
        | profile set-default work                                                  | .default   |

    @REQ-147 @REQ-044
    Scenario: A refused delete says so in its own words
      Given a profile "work" with no chains
      And the default pointer names "other"
      And the profiles directory is not writable
      When I run "evm profile remove work"
      Then the exit code is 1
      And standard error is exactly:
        """
        Could not remove {config}/profiles/work.yaml: permission denied. Nothing removed.
        Check the directory: ls -ld {config}/profiles
        """
      And the profile "work" still exists

    @REQ-147
    Scenario: A failure that is not about permissions is passed through unchanged
      Given a directory at "{config}/profiles/work.yaml"
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is the operating system's own message
      And standard error does not contain "Check the directory"

  Rule: Every file created or rewritten, and the pointer, ends at mode 0600 (REQ-036)

    @REQ-036
    Scenario Outline: Each creation path leaves an owner-only file
      Given the starting state for "<operation>"
      When I run "evm <operation>"
      Then the exit code is 0
      And the file it wrote has mode 0600

      Examples:
        | operation                                                                    |
        | chain list                                                                   |
        | profile create myproject                                                     |
        | profile create myproject --empty                                             |
        | profile clone alpha myproject                                                |
        | profile clone alpha existing --force                                         |
        | profile set-default alpha                                                    |
        | chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p alpha |
        | explorer set etherscan somekey --no-verify -p alpha                          |

    @REQ-036
    Scenario: A copy does not inherit the source's laxer permissions
      Given a profile file "{root}/project/shared.yaml" with no chains, at mode 0644
      When I run "evm profile clone {root}/project/shared.yaml team"
      Then the file "{config}/profiles/team.yaml" has mode 0600

    @REQ-036 @REQ-015
    Scenario: The first-run seed is owner-only even though the bundled file is not
      When I run "evm chain list"
      Then the file "{config}/profiles/default.yaml" has mode 0600

  Rule: A command that cannot complete refuses rather than half-writes (REQ-042, REQ-043, REQ-052, REQ-057)

    @REQ-042
    Scenario: Creating over an existing profile is refused, and the file is untouched
      Given a profile "myproject" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm profile create myproject"
      Then the exit code is 1
      And standard error is exactly "Profile already exists: {config}/profiles/myproject.yaml"
      And the profile "myproject" is byte-unchanged

    @REQ-043
    Scenario: Cloning over an existing target is refused, and names the way past
      Given a profile "alpha" with no chains
      And a profile "team" with no chains
      When I run "evm profile clone alpha team"
      Then the exit code is 1
      And standard error is exactly "Profile already exists: {config}/profiles/team.yaml (pass --force to overwrite)"
      And the profile "team" is byte-unchanged

    @REQ-043
    Scenario: A clone onto itself is refused before anything is opened for writing
      Given a profile "alpha" with no chains
      When I run "evm profile clone alpha alpha"
      Then the exit code is 1
      And standard error is exactly "Source and target are the same file"
      And the profile "alpha" is byte-unchanged

    @REQ-043
    Scenario: A missing clone source is refused
      When I run "evm profile clone ghost team"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/ghost.yaml"
      And the configuration directory is still empty

    @REQ-044
    Scenario: Removing a profile that does not exist lists what does
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      When I run "evm profile remove ghost"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/ghost.yaml (available: alpha, beta)"
      And both "alpha" and "beta" still exist

  Rule: A missing bundled profile is reported as such (REQ-140)

    @REQ-140 @code-only
    Scenario: An installation without its config directory says what is missing
      Given the installed package has no "config/default-profile.yaml"
      When I run "evm chain list"
      Then the exit code is 1
      And standard error contains "Could not locate bundled config/default-profile.yaml"

  Rule: A filesystem failure prints its message alone, with no stack trace (REQ-009)

    @REQ-009
    Scenario: A directory where a profile file should be
      Given a directory at "{config}/profiles/work.yaml"
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is a single line
      And standard error contains no "at " stack frame

    @REQ-009
    Scenario: A profile the operator cannot read
      Given a profile "locked" with no chains, at mode 0000
      When I run "evm chain list -p locked"
      Then the exit code is 1
      And standard error is a single line
      And standard error contains no "at " stack frame

    @REQ-009 @REQ-057
    Scenario: An unreadable profile stops a write command too, before it writes
      Given a profile "locked" with no chains, at mode 0000
      When I run "evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p locked"
      Then the exit code is 1
      And standard error is a single line
      And the profiles directory holds only "locked.yaml"

  Rule: Every message that stops a command appears in the troubleshooting reference (REQ-133)

    @REQ-133
    # REQ-133's acceptance was extended on 2026-08-01. A filesystem error is
    # relayed from the operating system and has no fixed verbatim form, so it is
    # catalogued as its own section rather than as a table row.
    Scenario Outline: A relayed filesystem failure is catalogued with a cause and a fix
      Given <situation>
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is the operating system's own message
      And docs/troubleshooting.md carries a section covering "<code>", with a cause and a fix
      And that section names the command that inspects permissions and the one that repairs them

      Examples:
        | situation                                     | code   |
        | a directory at "{config}/profiles/work.yaml"  | EISDIR |
        | a profile "work" with no chains, at mode 0000 | EACCES |

    @REQ-133 @REQ-057
    Scenario: The catalogue's claim about write commands holds
      Given a profile "work" with no chains, at mode 0000
      When I run "evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p work"
      Then the exit code is 1
      And the profile "work" is byte-unchanged

  Rule: A read command survives a filesystem problem that affects only one profile (REQ-040)

    @REQ-040
    Scenario: An unreadable profile does not hide the readable ones
      Given a profile "alpha" with no chains
      And a profile "locked" with no chains, at mode 0000
      When I run "evm profile list"
      Then the exit code is 0
      And both "alpha" and "locked" are listed
      And the chain-count cell for "locked" reads "error"
