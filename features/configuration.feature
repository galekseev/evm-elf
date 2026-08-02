# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 4

Feature: Missing and malformed configuration
  An operator runs a command on a machine that has never run one, or against a
  profile somebody hand-edited.

  Two rules divide this space, and the line between them is the point. A problem
  with the file is the command's problem and stops it. A problem with one chain
  inside the file is that chain's problem and becomes a row.

  Background:
    Given an empty configuration directory

  Rule: default.yaml is seeded from the bundled profile whenever the resolved name is default (REQ-015)

    @REQ-015
    Scenario Outline: A first run creates the default profile however the name was reached
      When I run "evm <command>"
      Then the exit code is 0
      And the file "{config}/profiles/default.yaml" names 14 chains
      And standard error contains "Created {config}/profiles/default.yaml from the bundled default profile"

      Examples:
        | command               |
        | chain list            |
        | chain list -p default |

    @REQ-015 @REQ-057
    Scenario: A write command also seeds, when the name it resolved is default
      When I run "evm chain set base https://mainnet.base.org --chain-id 8453 --no-verify -p default"
      Then the exit code is 0
      And the file "{config}/profiles/default.yaml" exists

    @REQ-015 @REQ-057
    Scenario: A name that is not default is never created on the operator's behalf
      When I run "evm chain list -p neverexisted"
      Then the exit code is 1
      And the configuration directory is still empty

    @REQ-006 @REQ-015
    Scenario: The seeding notice goes to standard error, leaving standard output clean
      When I run "evm chain list --json"
      Then the exit code is 0
      And standard output parses as JSON
      And standard error contains "from the bundled default profile"

  Rule: A missing profile that was not named by -p reports where the name came from (REQ-026)

    @REQ-026
    Scenario: A name from the environment says so
      Given the environment variable "EVM_ELF_PROFILE" is exported as "myproject"
      When I run "evm chain list"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/myproject.yaml ('myproject' comes from $EVM_ELF_PROFILE)"

    @REQ-026
    Scenario: A name from the pointer file says so, and says how to change it
      Given the default pointer names "myproject"
      When I run "evm chain list"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/myproject.yaml ('myproject' is the default; change it with: evm profile set-default <name>)"

    @REQ-026
    Scenario: A name the operator typed needs no explanation of where it came from
      When I run "evm chain list -p myproject"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/myproject.yaml"

  Rule: The four write commands fail on a missing profile and create nothing (REQ-057)

    @REQ-057
    Scenario Outline: A typo in -p does not fork a new profile
      When I run "evm <command> -p neverexisted"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/neverexisted.yaml"
      And the configuration directory is still empty

      Examples:
        | command                                                          |
        | chain set base https://mainnet.base.org --chain-id 1 --no-verify |
        | chain remove base                                                |
        | explorer set etherscan somekey --no-verify                       |
        | explorer remove etherscan                                        |

  Rule: A profile needs a top-level chains mapping, and ignores anything else (REQ-028)

    @REQ-028
    Scenario: An unrecognised top-level key is tolerated
      Given a profile "work" containing:
        """
        rpc_timeout: 30
        chains:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
        """
      When I run "evm chain list -p work"
      Then the exit code is 0
      And the result carries 1 chain row

    @REQ-028
    Scenario: A misspelled chains key reads as a missing one
      Given a profile "work" containing:
        """
        chainz:
          base:
            chain_id: 8453
            rpc_url: https://mainnet.base.org
        """
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid profile {config}/profiles/work.yaml: expected a top-level 'chains' mapping"

  Rule: A chain entry accepts exactly six fields, and an unknown one rejects the profile (REQ-029)

    @REQ-029
    Scenario: A misspelled field rejects the file rather than querying the wrong endpoint
      Given a profile "work" containing:
        """
        chains:
          base:
            chain_id: 8453
            rpc_urls: https://mainnet.base.org
        """
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid profile: chain 'base' in {config}/profiles/work.yaml has unknown field 'rpc_urls'"

    @REQ-029
    Scenario Outline: A chain id that is not a number rejects the profile
      Given a profile "work" whose chain "base" has chain_id <chain_id>
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error contains "has a non-numeric chain_id"

      Examples:
        | chain_id |
        | "8453"   |
        | 8453.5   |

    @REQ-029
    Scenario: A chain name with nothing beneath it rejects the profile
      Given a profile "work" containing:
        """
        chains:
          base:
        """
      When I run "evm chain list -p work"
      Then the exit code is 1
      And standard error contains "must be a mapping with chain_id and rpc_url"

  Rule: An entry missing chain_id or rpc_url is that chain's error, not the profile's (REQ-030)

    @REQ-030 @REQ-145
    Scenario: A half-written entry still lists, and its neighbours still answer
      Given a profile "work" containing:
        """
        chains:
          nourl:
            chain_id: 8453
          noid:
            rpc_url: https://mainnet.base.org
          solo:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
        """
      And the endpoint "solo" answers as a healthy node
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the row for "nourl" reads "No RPC URL configured (evm chain set nourl <rpc-url>)"
      And the row for "noid" reads "No chain_id set (evm chain set noid <rpc-url> --chain-id <id>)"
      And the row for "solo" carries a result

    @REQ-047
    Scenario: A chain list renders what is missing rather than failing
      Given a profile "work" containing:
        """
        chains:
          nourl:
            chain_id: 8453
        """
      When I run "evm chain list -p work"
      Then the exit code is 0
      And the "RPC URL" cell reads "not set"
      And the "Token" cell reads "-"

  Rule: The explorers section accepts only the two known sources (REQ-032)

    @REQ-032
    Scenario: A hand-edited unknown source rejects the profile
      Given a profile "work" containing:
        """
        chains: {}
        explorers:
          etherscn: somekey
        """
      When I run "evm explorer list -p work"
      Then the exit code is 1
      And standard error is exactly "Invalid profile {config}/profiles/work.yaml: unknown explorer 'etherscn' (known: etherscan, blockscout)"

  Rule: profile list shows an unparseable profile as error and still lists the others (REQ-040)

    @REQ-040
    Scenario: One broken file does not hide the rest
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And a profile "broken" whose contents are not valid YAML
      When I run "evm profile list"
      Then the exit code is 0
      And all three of "alpha", "beta" and "broken" are listed
      And the chain-count cell for "broken" reads "error"
      And the parse error is printed beneath the row for "broken"

  Rule: A bare name resolves to .yaml, falling back to .yml (REQ-025)

    @REQ-025
    Scenario: The alternative extension is found when it is the only one
      Given a profile file "{config}/profiles/myproject.yml" with no chains
      When I run "evm chain list -p myproject"
      Then the exit code is 0
      And standard output names the path "{config}/profiles/myproject.yml"

    @REQ-025
    Scenario: With both present, .yaml wins
      Given a profile file "{config}/profiles/myproject.yaml" with no chains
      And a profile file "{config}/profiles/myproject.yml" with no chains
      When I run "evm chain list -p myproject"
      Then standard output names the path "{config}/profiles/myproject.yaml"

  Rule: An RPC URL takes exactly two forms (REQ-018)

    @REQ-018
    Scenario: A URL and an auth key are separated by one pipe
      Given a profile "work" containing:
        """
        chains:
          solo:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}|topsecret
        """
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the endpoint receives an "auth-key" header of "topsecret"

    @REQ-018
    Scenario: More than one pipe is refused
      Given a profile "work" containing:
        """
        chains:
          solo:
            chain_id: 31337
            rpc_url: https://host/rpc|a|b
        """
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the row for "solo" reads "Invalid RPC URL: expected <URL> or <URL>|<AUTH_KEY>"

    @REQ-018 @REQ-031
    Scenario: A reference is resolved before the pipe is split
      Given the environment variable "SOLO_KEY" is exported as "topsecret"
      And a profile "work" containing:
        """
        chains:
          solo:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}|${SOLO_KEY}
        """
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the endpoint receives an "auth-key" header of "topsecret"

  Rule: Every message that stops a command appears in the troubleshooting reference (REQ-133)

    @REQ-133
    # REQ-133's acceptance was extended on 2026-08-01 to cover the two classes of
    # message the CLI relays rather than composes. A parse error has no fixed
    # verbatim form, so it is catalogued as its own section rather than as a
    # table row — including the fact that it names no file.
    Scenario: A syntax error is relayed from the parser and catalogued as such
      Given a profile "broken" whose contents are not valid YAML
      When I run "evm chain list -p broken"
      Then the exit code is 1
      And standard error carries the parser's own message, with a line and column
      And standard error contains no "at " stack frame
      And docs/troubleshooting.md carries a section for it, with a cause and a fix
      And that section says the message names no file, and how to find which profile it was

    @REQ-133 @REQ-040
    Scenario: The catalogued fix works
      Given a profile "alpha" with no chains
      And a profile "broken" whose contents are not valid YAML
      When I run "evm profile list"
      Then the exit code is 0
      And the row for "broken" identifies it as the unparseable one
      And the row for "alpha" is unaffected
