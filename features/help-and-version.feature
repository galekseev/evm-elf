# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 3

Feature: Help and version output
  An operator asks the binary what it is and what it can do, before trusting it
  with a key.

  Root help carries one thing no documentation page can: the configuration
  directory as resolved on this machine, and the precedence that chose the
  profile. That is the piece a reader cannot deduce from anywhere else.

  Background:
    Given an empty configuration directory

  Rule: --version prints the version from the installed manifest (REQ-002)

    @REQ-002
    Scenario: The reported version is the published one
      When I run "evm --version"
      Then the exit code is 0
      And standard output is exactly "1.0.0"
      And standard error is empty

  Rule: --help is available at the root, at each group, and at each subcommand (REQ-003)

    @REQ-003
    Scenario Outline: Help is offered at all three levels
      When I run "evm <target> --help"
      Then the exit code is 0
      And standard output describes "<target>"

      Examples:
        | target         |
        |                |
        | wallet         |
        | wallet balance |
        | contract       |
        | contract code  |
        | chain          |
        | chain set      |
        | explorer       |
        | explorer set   |
        | profile        |
        | profile create |

  Rule: Root help prints the resolved profiles directory and the four-source precedence (REQ-003, REQ-010)

    @REQ-003
    Scenario: The configuration block names the path this machine will use
      When I run "evm --help"
      Then standard output carries a "Configuration:" block
      And that block names the absolute path "{config}/profiles/<name>.yaml"
      And that block names all four sources of the profile in use, in precedence order:
        | -p, --profile          |
        | $EVM_ELF_PROFILE       |
        | the .default pointer   |
        | the built-in "default" |

    @REQ-010
    Scenario: The reported path follows the configuration directory variable
      Given the environment variable "EVM_ELF_CONFIG_DIR" is exported as "/tmp/scratch"
      When I run "evm --help"
      Then standard output contains "/tmp/scratch/profiles/"

  Rule: Root help lists the five groups, alongside the parser's own help entry (REQ-001)

    @REQ-001
    # The `help [command]` entry belongs to the argument parser rather than to
    # this CLI's command surface. REQ-001 was amended on 2026-08-01 to say so;
    # it previously read "and no others".
    Scenario: The Commands block holds the five groups and the parser's built-in
      When I run "evm --help"
      Then the entries under "Commands:" are exactly:
        | wallet         |
        | contract       |
        | chain          |
        | explorer       |
        | profile        |
        | help [command] |

  Rule: Every subcommand's help prints its own options and at least one worked example (REQ-134)

    @REQ-134
    Scenario: Each of the 21 subcommands demonstrates itself
      When I run "--help" on each of the 21 subcommands
      Then each prints its own options
      And each prints at least one example invocation

    @REQ-134
    Scenario: A worked example is a command a reader could paste
      When I run "evm chain set --help"
      Then standard output contains "evm chain set base https://mainnet.base.org"
      And standard output explains that an empty value clears a field

  Rule: Help and version read no profile and write nothing (REQ-016, REQ-138)

    @REQ-138 @REQ-015
    Scenario: Asking for help does not seed a configuration directory
      When I run "evm --help"
      Then the exit code is 0
      And the configuration directory is still empty

    @REQ-138
    Scenario: Asking for the version does not seed a configuration directory
      When I run "evm --version"
      Then the exit code is 0
      And the configuration directory is still empty

    @REQ-009
    Scenario: Help succeeds even when the profile in use is broken
      Given a profile "default" whose contents are not valid YAML
      When I run "evm --help"
      Then the exit code is 0
      And standard output carries a "Configuration:" block
