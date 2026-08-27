use blackbox_arena_contracts::capability_gatekeeper::{
    ICapabilityGatekeeperDispatcher, ICapabilityGatekeeperDispatcherTrait,
};
use blackbox_arena_contracts::capability_token::{
    ICapabilityTokenDispatcher, ICapabilityTokenDispatcherTrait,
};
use blackbox_arena_contracts::mock_prize_token::{
    IMockPrizeTokenDispatcher, IMockPrizeTokenDispatcherTrait,
};
use blackbox_arena_contracts::treasury_spend_adapter::{
    ITreasurySpendAdapterDispatcher, ITreasurySpendAdapterDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, start_cheat_transaction_hash_global,
    stop_cheat_block_timestamp_global, stop_cheat_caller_address,
    stop_cheat_transaction_hash_global,
};
use starknet::{ContractAddress, SyscallResultTrait};

const ISSUER: ContractAddress = 'ISSUER'.try_into().unwrap();
const POOL: ContractAddress = 'PRIVACY_POOL'.try_into().unwrap();
const TREASURY: ContractAddress = 'TREASURY'.try_into().unwrap();
const RECIPIENT: ContractAddress = 'RECIPIENT'.try_into().unwrap();
const OTHER: ContractAddress = 'OTHER'.try_into().unwrap();
const SPEND_SELECTOR: felt252 = selector!("spend");
const TX_HASH: felt252 = 'SPEND_TX';

fn setup() -> (
    ICapabilityGatekeeperDispatcher,
    ICapabilityTokenDispatcher,
    ITreasurySpendAdapterDispatcher,
    IMockPrizeTokenDispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
) {
    start_cheat_block_timestamp_global(100);

    let (gatekeeper_address, _) = declare("CapabilityGatekeeper")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![POOL.into()])
        .unwrap_syscall();
    let (asset_address, _) = declare("MockPrizeToken")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![])
        .unwrap_syscall();
    let (adapter_address, _) = declare("TreasurySpendAdapter")
        .unwrap_syscall()
        .contract_class()
        .deploy(
            @array![
                gatekeeper_address.into(),
                TREASURY.into(),
                asset_address.into(),
                RECIPIENT.into(),
            ],
        )
        .unwrap_syscall();
    let (capability_address, _) = declare("CapabilityToken")
        .unwrap_syscall()
        .contract_class()
        .deploy(
            @array![
                'Bounded Payout',
                'BB_PAY',
                ISSUER.into(),
                POOL.into(),
                gatekeeper_address.into(),
            ],
        )
        .unwrap_syscall();

    let gatekeeper = ICapabilityGatekeeperDispatcher { contract_address: gatekeeper_address };
    let capability = ICapabilityTokenDispatcher { contract_address: capability_address };
    let adapter = ITreasurySpendAdapterDispatcher { contract_address: adapter_address };
    let asset = IMockPrizeTokenDispatcher { contract_address: asset_address };

    start_cheat_caller_address(gatekeeper_address, ISSUER);
    gatekeeper.register_policy(
        capability_address,
        adapter_address,
        SPEND_SELECTOR,
        true,
        100,
        1_000,
        false,
    );
    stop_cheat_caller_address(gatekeeper_address);

    start_cheat_caller_address(capability_address, ISSUER);
    capability.mint(POOL, 1);
    stop_cheat_caller_address(capability_address);

    asset.mint(TREASURY, 1_000);
    start_cheat_caller_address(asset_address, TREASURY);
    asset.approve(adapter_address, 100);
    stop_cheat_caller_address(asset_address);

    (
        gatekeeper,
        capability,
        adapter,
        asset,
        gatekeeper_address,
        capability_address,
        adapter_address,
    )
}

fn deliver(
    capability: ICapabilityTokenDispatcher,
    capability_address: ContractAddress,
    gatekeeper_address: ContractAddress,
) {
    start_cheat_transaction_hash_global(TX_HASH);
    start_cheat_caller_address(capability_address, POOL);
    capability.transfer(gatekeeper_address, 1);
    stop_cheat_caller_address(capability_address);
}

fn finish_cheats() {
    stop_cheat_transaction_hash_global();
    stop_cheat_block_timestamp_global();
}

#[test]
fn test_capability_executes_fixed_treasury_payout() {
    let (
        gatekeeper,
        capability,
        adapter,
        asset,
        gatekeeper_address,
        capability_address,
        adapter_address,
    ) = setup();
    deliver(capability, capability_address, gatekeeper_address);

    start_cheat_caller_address(gatekeeper_address, POOL);
    let deposits = gatekeeper.privacy_invoke(
        capability_address,
        adapter_address,
        SPEND_SELECTOR,
        array![75].span(),
        0,
    );
    stop_cheat_caller_address(gatekeeper_address);

    assert!(deposits.is_empty());
    assert_eq!(asset.balance_of(TREASURY), 925);
    assert_eq!(asset.balance_of(RECIPIENT), 75);
    assert_eq!(asset.balance_of(OTHER), 0);
    assert_eq!(adapter.get_total_spent(), 75);
    assert_eq!(
        adapter.get_config(),
        (gatekeeper_address, TREASURY, asset.contract_address, RECIPIENT),
    );
    finish_cheats();
}

#[test]
#[should_panic(expected: 'ONLY_GATEKEEPER')]
fn test_direct_treasury_spend_rejected() {
    let (_, _, adapter, _, _, _, adapter_address) = setup();
    start_cheat_caller_address(adapter_address, OTHER);
    adapter.spend(1);
}

#[test]
#[should_panic(expected: 'ARG_TOO_HIGH')]
fn test_treasury_capability_amount_limit_enforced() {
    let (gatekeeper, capability, _, _, gatekeeper_address, capability_address, adapter_address) =
        setup();
    deliver(capability, capability_address, gatekeeper_address);
    start_cheat_caller_address(gatekeeper_address, POOL);
    gatekeeper.privacy_invoke(
        capability_address,
        adapter_address,
        SPEND_SELECTOR,
        array![101].span(),
        0,
    );
}
