Feature: Contract deploy-info
  As someone reviewing a contract that lives on several chains
  I want to know how each deployment was created, and with which salt
  So that I can tell a deterministic deployment from a coincidence, and reproduce
  the address myself

  A deployment method is only reported once the address has been recomputed from
  the values found on chain. Where that recomputation fails, the report says so
  rather than guessing.

  Background:
    Given a profile whose chains answer over RPC
    And an explorer API key that answers for those chains

  Scenario: A contract deployed straight from an account
    Given "0x6B175474E89094C44Da98b954EedeAC495271d0F" was created by a transaction with no recipient
    And the sender was "0xb5b06a16621616875A6C2637948bF98eA57c58fa" at nonce 1
    When I ask for the deployment of that address on mainnet
    Then the method is reported as CREATE
    And the deployer is reported as "0xb5b06a16621616875A6C2637948bF98eA57c58fa"
    And no salt is reported
    And the report notes that a nonce-based address cannot be reproduced on another chain

  Scenario: A contract deployed with CREATE2 through a well-known factory
    Given the contract was created by a call to "0x4e59b44847b379578588920cA78FbF26c0B4956C"
    And the call carried a salt followed by the contract's init code
    When I ask for the deployment of that address
    Then the method is reported as CREATE2
    And the factory is named as the Arachnid deterministic deployment proxy
    And the salt from the call is reported
    And the salt is confirmed, because the factory, the salt and the init code hash reproduce the address

  Scenario: A contract deployed with CREATE3 through CreateX
    Given the contract was created by a call to "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed"
    And the caller submitted a salt whose first 20 bytes are their own address
    When I ask for the deployment of that address
    Then the method is reported as CREATE3
    And the factory is named as CreateX
    And both the submitted salt and the guarded salt CreateX derived from it are reported
    And the rule that produced the guarded salt is named
    And the salt is confirmed, because the guarded salt reproduces the intermediate proxy, and the proxy reproduces the address

  Scenario: A contract deployed with CREATE3 through a Solady-style factory
    Given the contract was created through a factory that deploys the canonical CREATE3 proxy
    And the factory used the salt exactly as submitted
    When I ask for the deployment of that address
    Then the method is reported as CREATE3
    And the submitted salt is reported
    And no guarded salt is reported
    And the salt is confirmed against the proxy and the address

  Scenario: A contract deployed with CREATE3 through the current 1inch deployer
    Given the contract was created by a call to an Ownable CREATE3 deployer at an address in no registry
    And that deployer takes a salt and init code, as a Solady-style factory does
    When I ask for the deployment of that address
    Then the factory is recognised from the shape of the call rather than from its address
    And the method is reported as CREATE3
    And the factory's owner is reported, as the only account that can deploy through it
    And the salt is confirmed, and the factory's own view of the address for that salt agrees

  Scenario: A contract deployed with CREATE3 through the old 1inch deployer, whose proxy self-destructs
    Given "0xa7bCb4EAc8964306F9e3764f67Db6A7af6DdF99A" was created through "0x65B3Db8bAeF0215A1F9B14c506D2a3078b2C84AE" with salt "0x551cf9a686486608d89182cdefb06db09f5e95c7447085d60212d39279480f59"
    And the proxy at "0xFb742D35dD3A3Ca8Da4A79AC062064164845C6B9" destroyed itself in the same transaction, so it holds no code
    When I ask for the deployment of that address on mainnet
    Then the method is reported as CREATE3
    And the proxy is reported as self-destructed
    And the salt "0x551cf9a686486608d89182cdefb06db09f5e95c7447085d60212d39279480f59" is reported
    And the salt is confirmed, because the recomputation never needed the proxy's code

  Scenario: A contract deployed through a factory nobody has catalogued
    Given the contract was created by a call to a factory that is in no registry
    And one 32-byte word in that call reproduces the address as a CREATE2 salt
    When I ask for the deployment of that address
    Then the method is reported as CREATE2
    And that word is reported as the salt
    And the salt is confirmed

  Scenario: A factory whose salt cannot be recovered
    Given the contract was created by a call to a factory that is in no registry
    And no word in that call reproduces the address
    When I ask for the deployment of that address
    Then the method is reported as CREATE by a contract
    And the creating contract is reported
    And the salt is reported as not recovered, with the reason
    And the report does not claim the deployment was deterministic

  Scenario: An address that holds nothing on one of the chains
    Given the contract is deployed on base but not on sepolia
    When I ask for the deployment of that address on base and sepolia
    Then sepolia reports that there is no code at the address
    And base still reports its deployment

  Scenario: No explorer key configured
    Given the profile has no explorer API key
    When I ask for the deployment of an address
    Then each chain reports that the lookup needs an explorer API
    And the run explains once how to add a key
    And that explanation is kept out of the machine-readable output

  Scenario: A creation transaction the chain no longer serves
    Given the explorer knows the creation transaction of the contract
    But the RPC endpoint no longer holds that transaction
    When I ask for the deployment of that address
    Then the deployer and the creation transaction are still reported
    And the method is reported as unknown

  Scenario: Comparing one address across chains
    Given the contract was deployed with the same factory and salt on base and arbitrum
    And with a plain CREATE on mainnet
    When I ask for the deployment of that address on all three chains
    Then each chain is listed with its method and its deployer or factory
    And a summary groups the chains by deployment, naming the salt of each group
    And the summary says the deployments are identical when every chain agrees

  Scenario: Reading the detail, and reading it as data
    Given the contract was deployed with CREATE3 on base
    When I ask for the full deployment detail of that address on base
    Then the salt, the intermediate proxy, the init code hash, the creation transaction and the date are reported
    When I ask for the deployment of that address as JSON
    Then one object per chain carries the same facts, including whether the salt was confirmed

  Scenario: An address that is not an address
    When I ask for the deployment of "0xnot-an-address"
    Then the command reports an invalid address
    And exits with a failure code

  @deferred
  Scenario: Reading the opcode from a trace
    Given the contract was created by a factory whose salt could not be recovered
    When I ask for the deployment of that address with tracing enabled
    Then the creating opcode is read from the transaction trace
    And CREATE is distinguished from CREATE2 without needing the salt
