# Derived from docs/reverse-engineer/requirements-specification.md
# Example Map: features/example-map.md, story 8

Feature: Network and external service failures
  An operator fans a read out across fourteen public endpoints, one of which is
  down, the price service is rate-limited, and no explorer key is configured.

  With the bundled profile's public endpoints, some chain failing is the common
  case rather than the exception. So the governing rule is that a per-chain
  failure is a row and not a command failure — which in turn is why a script has
  to read the error field rather than the exit code.

  Background:
    Given an empty configuration directory

  Rule: A per-chain failure is a row, not a command failure (REQ-007, REQ-072, REQ-145)

    @REQ-007 @REQ-145
    Scenario: One unreachable endpoint among three leaves the other two intact
      Given a profile "work" containing:
        """
        chains:
          up1:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
          down:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
          up2:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
        """
      And the endpoint "{stub}" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then the exit code is 0
      And the row for "down" carries the endpoint's error in its "Status" cell
      And the rows for "up1" and "up2" carry balances

    @REQ-007
    Scenario: Every chain failing is still not a command failure
      Given a profile "work" containing:
        """
        chains:
          down1:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
          down2:
            chain_id: 56
            rpc_url: http://127.0.0.1:1
        """
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then the exit code is 0
      And every row carries an error

    @REQ-070 @REQ-007
    Scenario: A selected chain the profile does not define becomes a row naming the fix
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm contract owner 0x0000000000000000000000000000000000000001 -p work -c ghost"
      Then the exit code is 0
      And the row for "ghost" reads "Not in profile 'work' (evm chain set ghost <rpc-url>)"

    @REQ-069
    Scenario: An excluded chain the profile does not define warns and changes nothing
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                  | symbol |
        | base | 8453     | https://mainnet.base.org | ETH    |
      When I run "evm contract owner 0x0000000000000000000000000000000000000001 -p work -xc ghost"
      Then the exit code is 0
      And standard error contains "Warning: excluded chain 'ghost' is not in profile 'work'"
      And the result still carries 1 chain row

    @REQ-072
    Scenario: Resolving a chain never raises, whatever the profile says about it
      Given a profile "work" holding one entry of each failing kind:
        | kind                 | entry                              |
        | not in profile       | selected with -c but never defined |
        | no chain_id          | rpc_url only                       |
        | no rpc_url           | chain_id only                      |
        | unresolved ${VAR}    | rpc_url naming an unset variable   |
        | unreachable endpoint | a refused port                     |
      When I run "evm contract code 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And every row carries a populated error rather than an exception

  Rule: A failed chain's JSON object carries error alongside zeroed placeholders (REQ-085)

    @REQ-085
    Scenario: The zeros are a placeholder, and the error is how a script knows
      Given a profile "work" containing:
        """
        chains:
          down:
            chain_id: 8453
            rpc_url: http://127.0.0.1:1
        """
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd --json"
      Then the exit code is 0
      And the object for "down" holds:
        | balance    | "0" |
        | balanceEth | "0" |
        | nonce      | 0   |
      And the object for "down" holds a populated "error"

  Rule: The chain-id check is bounded, and reports the documented failure with its escape hatch (REQ-051, REQ-136)

    @REQ-051 @REQ-136
    Scenario: An endpoint that accepts the connection and never answers is abandoned
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

    @REQ-051
    Scenario: A refused connection is reported the same way
      Given a profile "work" with no chains
      When I run "evm chain set down http://127.0.0.1:1 -p work"
      Then the exit code is 1
      And standard error contains "Could not read the chain id from http://127.0.0.1:1"
      And standard error contains "Pass --no-verify --chain-id <id> to write the entry anyway."
      And the profile "work" is byte-unchanged

    @REQ-053
    Scenario: The escape hatch writes the entry without contacting anything
      Given a profile "work" with no chains
      When I run "evm chain set down http://127.0.0.1:1 --no-verify --chain-id 8453 -p work"
      Then the exit code is 0
      And the profile "work" gains a chain "down" with chain id 8453
      And no outbound request is made

  Rule: A --chain-id that disagrees with the endpoint aborts the write (REQ-052)

    @REQ-052
    Scenario: A copied RPC URL is caught before it returns another chain's data
      Given a profile "work" with no chains
      And an endpoint reporting chain id 8453
      When I run "evm chain set mainnet {endpoint} --chain-id 1 -p work"
      Then the exit code is 1
      And standard error is exactly "Chain id mismatch: {endpoint} reports 8453, expected 1. Nothing written."
      And the profile "work" is byte-unchanged

  Rule: A price lookup that fails leaves the USD column empty and is not retried (REQ-128)

    @REQ-128
    Scenario: An unreachable price service does not cost the operator their balances
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      And the price service is unreachable
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the exit code is 0
      And the "Balance (Native)" and "Nonce" cells are populated
      And the "Value (USD)" column is empty
      And the price request is not retried

    @REQ-082 @REQ-127
    Scenario: A chain with no coingecko_id is unpriced and excluded from the total
      Given a profile "work" with chains:
        | name    | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo    | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
        | sepolia | 11155111 | http://127.0.0.1:{stub} | ETH    |              |
      And the endpoint "{stub}" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work"
      Then the "Value (USD)" cell for "sepolia" reads "-"
      And the total sums only the priced chains
      And standard output contains "No price for: sepolia (excluded from total)"

  Rule: When an explorer lookup was wanted and no source remained, one note goes to stderr (REQ-131)

    @REQ-131
    Scenario: The note appears once, however many chains the run touched
      Given a profile "work" with 14 chains
      And no explorer key is configured
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work"
      Then standard error contains exactly once:
        """
        Skipped explorer lookups: no API key configured. Add one with: evm explorer set etherscan '${ETHERSCAN_API_KEY}'
        """

    @REQ-131 @REQ-108
    Scenario: The short form wants no lookup, so it emits no note
      Given a profile "work" with 14 chains
      And no explorer key is configured
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 -s -p work"
      Then standard error contains no "Skipped explorer lookups" note
      And the columns are "Chain, Chain ID, Proxy type"

  Rule: A source that answers with an error is skipped quietly (REQ-132)

    @REQ-132
    Scenario: A rejected key produces fewer fields and no explanation
      Given a profile "work" with 1 chain
      And an explorer key that the explorer rejects
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work"
      Then the exit code is 0
      And the explorer-backed fields are absent
      And standard error contains no "Skipped explorer lookups" note

  Rule: Sources are tried in a fixed order, and an unusable one is dropped before any request (REQ-129, REQ-130)

    @REQ-129 @code-only
    Scenario: A chain naming its own explorer_api is tried before the shared sources
      Given a profile "work" whose chain "zksync" sets an "explorer_api"
      And a key is configured for "etherscan"
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -c zksync -p work"
      Then the chain's own explorer is queried first

    @REQ-130
    Scenario: A source whose reference does not resolve is never contacted
      Given a profile "work" whose "explorers" section sets etherscan to "${ETHERSCAN_API_KEY}"
      And the environment variable "ETHERSCAN_API_KEY" is not exported
      When I run "evm contract proxy-info 0x0000000000000000000000000000000000000001 --full -p work"
      Then no request is sent to Etherscan
      And the walk moves to the next source

  Rule: explorer set asks the explorer about the key before storing it (REQ-062, REQ-063, REQ-064)

    @REQ-063
    Scenario: A reference that cannot be resolved cannot be checked, so it is refused
      Given a profile "work" with no chains
      And the environment variable "ETHERSCAN_API_KEY" is not exported
      When I run "evm explorer set etherscan '${ETHERSCAN_API_KEY}' -p work"
      Then the exit code is 1
      And standard error is exactly:
        """
        Could not resolve ${ETHERSCAN_API_KEY}: the environment variable is not set
        Pass --no-verify to write the entry anyway.
        """
      And the profile "work" is byte-unchanged

    @REQ-062 @code-only
    Scenario: A key the explorer rejects is not stored
      Given a profile "work" with no chains
      And the explorer rejects the key "badkey"
      When I run "evm explorer set etherscan badkey -p work"
      Then the exit code is 1
      And standard error contains "etherscan rejected the key:"
      And standard error contains "Pass --no-verify to write the entry anyway."
      And the profile "work" is byte-unchanged

    @REQ-064 @REQ-065
    Scenario: --no-verify writes without asking, and says the key was not checked
      Given a profile "work" with no chains
      When I run "evm explorer set etherscan '${ETHERSCAN_API_KEY}' --no-verify -p work"
      Then the exit code is 0
      And standard output contains "Added etherscan to {config}/profiles/work.yaml"
      And standard output contains "key not checked (--no-verify)"
      And no outbound request is made

    @REQ-065
    Scenario: Replacing an existing entry is reported as a replacement
      Given a profile "work" whose "explorers" section already sets etherscan
      When I run "evm explorer set etherscan '${OTHER_KEY}' --no-verify -p work"
      Then standard output contains "Updated etherscan in {config}/profiles/work.yaml"

  Rule: wallet send exits 1 only when every selected chain errored (REQ-096)

    @REQ-096
    Scenario Outline: One shared cause is worth an exit code; fourteen unrelated ones are not
      Given a profile "work" where <situation>
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --private-key DEPLOYER_PK -p work --exec"
      Then the exit code is <code>

      Examples:
        | situation                                | code |
        | one chain of three succeeds              | 0    |
        | all three chains error                   | 1    |
        | all three chains skip for a zero balance | 0    |

    @REQ-088
    Scenario: A sweep skips a chain that cannot cover its own gas reserve
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | poor | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "poor" reports a zero balance
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --private-key DEPLOYER_PK -p work"
      Then the exit code is 0
      And the row for "poor" reads "skip (zero balance)"

    @REQ-088
    Scenario: An endpoint that will not quote a gas price stops that chain alone
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      And the endpoint "solo" reports neither maxFeePerGas nor gasPrice
      And the environment variable "DEPLOYER_PK" holds the operator's private key
      When I run "evm wallet send 0x0000000000000000000000000000000000000001 --all --private-key DEPLOYER_PK -p work"
      Then the row for "solo" reads "Could not determine gas price"

  Rule: Every provider carries the chain's configured headers and its pinned chain ID (REQ-017, REQ-018)

    @REQ-017
    Scenario: Configured headers reach the endpoint on every request
      Given a profile "work" containing:
        """
        chains:
          solo:
            chain_id: 31337
            rpc_url: http://127.0.0.1:{stub}
            headers:
              auth-key: topsecret
              x-source: evm-elf
        """
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then every request the endpoint received carried "auth-key: topsecret"
      And every request the endpoint received carried "x-source: evm-elf"

    @REQ-017
    # The pin shows as a request never made: ethers asks the endpoint for its
    # chain id unless the provider was constructed with one. Carried @code-only
    # until 2026-08-01, when a stub that records what it was called with turned
    # out to observe the pin without a live chain.
    Scenario: The provider is created with the configured chain id rather than discovering it
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then no "eth_chainId" request reaches the endpoint
      And the endpoint is asked only for "eth_getBalance" and "eth_getTransactionCount"

  Rule: No outbound request goes anywhere but an endpoint, the price source, or an explorer (REQ-021)

    @REQ-021
    Scenario: No telemetry, update check, or analytics request is made
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    |
      When I run any command in this feature
      Then every outbound request went to a configured endpoint, the price source, or an explorer

    @REQ-084 @REQ-021
    Scenario: --no-usd issues no price request at all
      Given a profile "work" with chains:
        | name | chain_id | rpc_url                 | symbol | coingecko_id |
        | solo | 31337    | http://127.0.0.1:{stub} | ETH    | ethereum     |
      And the endpoint "solo" answers as a healthy node
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then no price request is issued
      And the "Value (USD)" column is absent from the table and from the totals

  Rule: Chains are queried one after another (REQ-071)

    @REQ-071 @code-only
    Scenario: A fan-out costs the sum of its endpoints, not the slowest of them
      Given a profile "work" with 3 chains, each answering after a measurable delay
      When I run "evm wallet balance 0x0000000000000000000000000000000000000001 -p work --no-usd"
      Then the elapsed time approximates the sum of the three delays
