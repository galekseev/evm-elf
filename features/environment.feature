# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 5

Feature: Environment variable precedence
  An operator keeps provider keys and a signing key out of files that get
  committed, and expects the same answer whether a variable was exported or
  written into a .env file.

  Two variables are deliberately exempt from the .env route, because the
  location they choose is where one of the .env files lives. Everything else
  resolves the same way from either source, and the environment always wins over
  a file.

  Background:
    Given an empty configuration directory

  Rule: Both .env files are loaded once per invocation, and neither overwrites the process environment (REQ-012)

    @REQ-012 @REQ-022
    Scenario Outline: The first source that names a profile wins
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And a profile "gamma" with no chains
      And the environment variable "EVM_ELF_PROFILE" is <exported>
      And the file "./.env" declares EVM_ELF_PROFILE as <cwd_env>
      And the file "{config}/.env" declares EVM_ELF_PROFILE as <config_env>
      When I run "evm profile list"
      Then the profile in use is "<winner>"

      Examples:
        | exported     | cwd_env | config_env | winner |
        | "alpha"      | beta    | gamma      | alpha  |
        | not exported | beta    | gamma      | beta   |
        | not exported | absent  | gamma      | gamma  |

    @REQ-022
    Scenario: An explicit -p outranks all three
      Given a profile "delta" with no chains
      And the environment variable "EVM_ELF_PROFILE" is exported as "alpha"
      When I run "evm chain list -p delta"
      Then the profile in use is "delta"

    @REQ-022
    Scenario: With no source at all, the built-in name is used
      When I run "evm profile list"
      Then the profile in use is "default"

    @REQ-012
    Scenario: A variable in ./.env behaves exactly as an exported one
      Given the file "./.env" declares DEPLOYER_PK as the operator's private key
      When I run "evm wallet address DEPLOYER_PK"
      Then the exit code is 0
      And standard output is the operator's checksummed address

    @REQ-012
    Scenario: A variable in the configuration directory's .env is found too
      Given the file "{config}/.env" declares DEPLOYER_PK as the operator's private key
      When I run "evm wallet address DEPLOYER_PK"
      Then the exit code is 0
      And standard output is the operator's checksummed address

    @REQ-012
    Scenario: Between the two files, the working directory's wins
      Given the file "./.env" declares DEPLOYER_PK as the private key of "operator one"
      And the file "{config}/.env" declares DEPLOYER_PK as the private key of "operator two"
      When I run "evm wallet address DEPLOYER_PK"
      Then standard output is the address of "operator one"

  Rule: The two configuration-directory variables are read from the environment only (REQ-011)

    @REQ-011
    Scenario: A configuration directory named in ./.env is ignored
      Given the file "./.env" declares EVM_ELF_CONFIG_DIR as "{root}/elsewhere"
      And the environment variable "EVM_ELF_CONFIG_DIR" is not exported
      And the environment variable "XDG_CONFIG_HOME" is exported as "{root}/xdg"
      When I run "evm --help"
      Then standard output names the profiles path under "{root}/xdg/evm-elf"
      And standard output does not name "{root}/elsewhere"

    @REQ-011
    Scenario: The same value exported does take effect
      Given the environment variable "EVM_ELF_CONFIG_DIR" is exported as "{root}/elsewhere"
      When I run "evm --help"
      Then standard output names the profiles path under "{root}/elsewhere"

  Rule: The configuration directory resolves in three steps (REQ-010)

    @REQ-010
    Scenario Outline: The first variable that is set decides
      Given the environment variable "EVM_ELF_CONFIG_DIR" is <config_dir>
      And the environment variable "XDG_CONFIG_HOME" is <xdg>
      And the environment variable "HOME" is exported as "{root}/home"
      When I run "evm --help"
      Then standard output names the profiles path under "<resolved>"

      Examples:
        | config_dir             | xdg                    | resolved                    |
        | exported as "{root}/a" | exported as "{root}/b" | {root}/a                    |
        | not exported           | exported as "{root}/b" | {root}/b/evm-elf            |
        | not exported           | not exported           | {root}/home/.config/evm-elf |

  Rule: profile list names both the profile in use and which source chose it (REQ-027)

    @REQ-027
    Scenario: A .env-supplied name is reported as coming from the variable
      Given a profile "myproject" with no chains
      And the file "./.env" declares EVM_ELF_PROFILE as "myproject"
      When I run "evm profile list"
      Then standard output contains "* in use: myproject (from $EVM_ELF_PROFILE)"
      And the row for "myproject" carries the "*" marker

    @REQ-027
    Scenario: A name from the pointer file is reported as such
      Given a profile "myproject" with no chains
      And the default pointer names "myproject"
      When I run "evm profile list"
      Then standard output contains "(set by evm profile set-default)"

    @REQ-027
    Scenario: The built-in name is reported as built-in, with the way to change it
      When I run "evm profile list"
      Then standard output contains "(built-in default; change it with evm profile set-default <name>)"

  Rule: A .env-supplied profile name reaches the safety-critical paths (REQ-044, REQ-045)

    @REQ-044
    Scenario: The in-use guard fires on a name that came from a file
      Given a profile "myproject" with no chains
      And the file "./.env" declares EVM_ELF_PROFILE as "myproject"
      When I run "evm profile remove myproject"
      Then the exit code is 1
      And standard error is exactly "'myproject' is the profile in use; pass --force to remove it, or point elsewhere first with evm profile set-default <name>"
      And the file "{config}/profiles/myproject.yaml" still exists

    @REQ-044
    Scenario: --force removes it and clears the pointer that named it
      Given a profile "myproject" with no chains
      And the default pointer names "myproject"
      When I run "evm profile remove myproject --force"
      Then the exit code is 0
      And the file "{config}/profiles/myproject.yaml" is gone
      And the file "{config}/profiles/.default" is gone

    @REQ-045
    Scenario: set-default warns that a variable still overrides the pointer it just wrote
      Given a profile "alpha" with no chains
      And a profile "beta" with no chains
      And the file "./.env" declares EVM_ELF_PROFILE as "beta"
      When I run "evm profile set-default alpha"
      Then the exit code is 0
      And standard output contains "Default profile is now alpha"
      And standard output contains "$EVM_ELF_PROFILE is set to 'beta' and overrides this until unset"

    @REQ-045
    Scenario: A default that does not exist is refused, with what is available
      Given a profile "alpha" with no chains
      When I run "evm profile set-default ghost"
      Then the exit code is 1
      And standard error is exactly "Profile not found: {config}/profiles/ghost.yaml (available: alpha; create it with evm profile create ghost)"

  Rule: ${VAR} in a profile resolves at run time, and an unresolved one is that chain's error (REQ-031)

    @REQ-031 @REQ-145
    Scenario: An unset reference fails one chain and leaves the others alone
      Given a profile "work" containing:
        """
        chains:
          arbitrum:
            chain_id: 42161
            rpc_url: ${ARBITRUM_RPC_URL}
          solo:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
        """
      And the environment variable "ARBITRUM_RPC_URL" is not exported
      And the endpoint "solo" answers as a healthy node
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the row for "arbitrum" reads "Environment variable ARBITRUM_RPC_URL not set"
      And the row for "solo" carries a result

    @REQ-031 @REQ-048
    Scenario: A chain list marks every reference it cannot resolve
      Given a profile "work" containing:
        """
        chains:
          arbitrum:
            chain_id: 42161
            rpc_url: ${ARBITRUM_RPC_URL}
            headers:
              auth-key: ${ARBITRUM_AUTH_KEY}
        """
      And the environment variable "ARBITRUM_RPC_URL" is not exported
      When I run "evm chain list -p work"
      Then standard output contains "${ARBITRUM_RPC_URL} (unset)"

    @REQ-031
    Scenario: A reference that resolves is used, and reported as written
      Given the environment variable "ARBITRUM_RPC_URL" is exported as "https://arb1.arbitrum.io/rpc"
      And a profile "work" containing:
        """
        chains:
          arbitrum:
            chain_id: 42161
            rpc_url: ${ARBITRUM_RPC_URL}
        """
      When I run "evm chain list -p work"
      Then standard output contains "${ARBITRUM_RPC_URL}"
      And standard output does not contain "(unset)"
      And standard output does not contain "https://arb1.arbitrum.io/rpc"

  Rule: EVM_PRICE_SOURCE selects the price source, and an unrecognised value selects none (REQ-125, REQ-126)

    @REQ-125
    Scenario Outline: A recognised value is honoured silently
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "EVM_PRICE_SOURCE" is exported as "<value>"
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And standard error carries no price warning
      And <requests> price request is issued

      Examples:
        | value     | requests |
        | none      | no       |
        | coingecko | one      |

    @REQ-126
    Scenario: An unrecognised value stops the lookup and says so
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "EVM_PRICE_SOURCE" is exported as "off"
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And standard error contains "Warning: unknown price source 'off', using 'none' (valid: coingecko, none)"
      And the "Value (USD)" column is empty
      And no price request is issued

    @REQ-126 @REQ-084
    Scenario: A run that wanted no prices anyway stays quiet
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "EVM_PRICE_SOURCE" is exported as "off"
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then standard error carries no price warning

  Rule: A key given as a variable name resolves from either source (REQ-074)

    @REQ-074
    Scenario Outline: The two accepted key forms
      When I run "evm wallet address <argument>"
      Then the exit code is 0
      And standard output is the operator's checksummed address

      Examples: A literal key, with and without the prefix
        | argument                                                           |
        | 0x0000000000000000000000000000000000000000000000000000000000000001 |
        | 0000000000000000000000000000000000000000000000000000000000000001   |

    @REQ-074 @REQ-012
    Scenario: A name is looked up in the environment, .env files included
      Given the file "./.env" declares DEPLOYER_PK as the operator's private key
      When I run "evm wallet address DEPLOYER_PK"
      Then the exit code is 0
      And standard output is the operator's checksummed address

    @REQ-019 @code-only
    Scenario: A CoinGecko key is sent as a demo key when the variable is set
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the environment variable "COINGECKO_API_KEY" is exported as "demo-key"
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the price request carries the demo key
      And exactly one price request is issued for the run
