use blackbox_arena_contracts::arena::{
    IArenaDispatcher, IArenaDispatcherTrait, reason,
};
use blackbox_arena_contracts::mock_prize_token::{
    IMockPrizeTokenDispatcher, IMockPrizeTokenDispatcherTrait,
};
use blackbox_arena_contracts::arena_adapter_v2::{
    IArenaAdapterV2Dispatcher, IArenaAdapterV2DispatcherTrait,
};
use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};

const START: u64 = 1_000;
const END: u64 = 2_000;
const SPONSOR: ContractAddress = 'SPONSOR'.try_into().unwrap();
const TARGET: ContractAddress = 'MOCK_EXECUTOR'.try_into().unwrap();
const POOL1: ContractAddress = 'POOL_ONE'.try_into().unwrap();
const POOL2: ContractAddress = 'POOL_TWO'.try_into().unwrap();
const STRAT_WALLET: ContractAddress = 'STRAT_WALLET'.try_into().unwrap();
const COMMITMENT: felt252 = 'STRAT_COMMIT';
const UNIT: u256 = 1_000_000_000_000_000_000;

// Adapter V2: per-pool custody. Flow mirrors honest round v5:
// venue pool approves adapter → execute_action PULLS allocation×price and
// records custody → Arena sees a contract-context submission → pool later
// withdraws ONLY its own receipts.

fn setup() -> (
    IMockPrizeTokenDispatcher,
    IArenaDispatcher,
    IArenaAdapterV2Dispatcher,
    ContractAddress,
    ContractAddress,
) {
    let (token_address, _) = declare("MockPrizeToken")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![])
        .unwrap_syscall();

    let (arena_address, _) = declare("Arena")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![
            SPONSOR.into(),
            START.into(),
            END.into(),
            1000_u128.into(),   // starting_units
            3500_u16.into(),    // max_allocation_bps
            2000_u16.into(),    // max_drawdown_bps
            100_u32.into(),     // prize_cap_units
            token_address.into(),
            1_u32.into(), token_address.into(),   // initial_assets
            1_u32.into(), TARGET.into(),          // initial_targets
            'R',
            64_u32.into(),      // max_strategies
        ])
        .unwrap_syscall();

    let (adapter_address, _) = declare("ArenaAdapterV2")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![arena_address.into()])
        .unwrap_syscall();

    let arena = IArenaDispatcher { contract_address: arena_address };
    let adapter = IArenaAdapterV2Dispatcher { contract_address: adapter_address };

    // Pre-start config (ts < START): bind adapter, price the asset.
    start_cheat_block_timestamp(arena_address, 500);
    start_cheat_caller_address(arena_address, SPONSOR);
    arena.set_action_adapter(adapter_address);
    let price_u128: u128 = UNIT.low;
    arena.set_price(token_address, price_u128);
    stop_cheat_caller_address(arena_address);
    stop_cheat_block_timestamp(arena_address);

    (
        IMockPrizeTokenDispatcher { contract_address: token_address },
        arena,
        adapter,
        token_address,
        arena_address,
    )
}

fn fund_and_register(
    token: IMockPrizeTokenDispatcher, arena: IArenaDispatcher,
    token_address: ContractAddress, arena_address: ContractAddress,
    adapter_address: ContractAddress, pool: ContractAddress,
    commitment: felt252, units: u256,
) {
    token.mint(pool, units);
    // Register the strategy from its own wallet (pre-start).
    start_cheat_block_timestamp(arena_address, 600);
    start_cheat_caller_address(arena_address, STRAT_WALLET);
    arena.register_strategy(commitment);
    stop_cheat_caller_address(arena_address);
    stop_cheat_block_timestamp(arena_address);
    // Venue funds delivery by approving the adapter for the planned amount.
    start_cheat_caller_address(token_address, pool);
    token.approve(adapter_address, units);
    stop_cheat_caller_address(token_address);
}

#[test]
fn test_execute_pulls_records_custody_and_accepts() {
    let (token, arena, adapter, token_address, arena_address) = setup();
    let receipt: felt252 = 'RCPT_A1';

    fund_and_register(
        token, arena, token_address, arena_address, adapter.contract_address,
        POOL1, COMMITMENT, 100 * UNIT,
    );

    // Execute INSIDE the round window (START <= ts <= END).
    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    let verdict = adapter.execute_action(
        receipt, COMMITMENT, token_address, TARGET,
        20_u128,       // allocation_units
        1000_u128,     // portfolio_value_before == starting_units
        980_u128,      // portfolio_value_after
        200_u16,       // drawdown_bps
    );
    stop_cheat_caller_address(adapter.contract_address);
    stop_cheat_block_timestamp(arena_address);

    assert_eq!(verdict, reason::ACCEPTED);

    // Custody recorded per (pool, receipt).
    let (custody_asset, custody_amount) = adapter.get_custody(POOL1, receipt);
    assert_eq!(custody_asset, token_address);
    assert_eq!(custody_amount, 20 * UNIT);

    // Delivered capital sits in the adapter; pool paid exactly 20 units.
    assert_eq!(token.balance_of(adapter.contract_address), 20 * UNIT);
    assert_eq!(token.balance_of(POOL1), 80 * UNIT);

    // Arena saw a contract-context ACCEPTED action (adapter == bound adapter).
    let (accepted, rejected) = arena.get_action_counts(COMMITMENT);
    assert_eq!(accepted, 1_u32);
    assert_eq!(rejected, 0_u32);
}

#[test]
fn test_two_pools_isolated_custody_and_exact_withdraws() {
    let (token, arena, adapter, token_address, arena_address) = setup();

    fund_and_register(
        token, arena, token_address, arena_address, adapter.contract_address,
        POOL1, COMMITMENT, 100 * UNIT,
    );
    token.mint(POOL2, 100 * UNIT);
    start_cheat_caller_address(token_address, POOL2);
    token.approve(adapter.contract_address, 100 * UNIT);
    stop_cheat_caller_address(token_address);

    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    adapter.execute_action('R1', COMMITMENT, token_address, TARGET, 20_u128, 1000_u128, 980_u128, 200_u16);
    stop_cheat_caller_address(adapter.contract_address);
    start_cheat_caller_address(adapter.contract_address, POOL2);
    adapter.execute_action('R2', COMMITMENT, token_address, TARGET, 5_u128, 980_u128, 975_u128, 51_u16);
    stop_cheat_caller_address(adapter.contract_address);
    stop_cheat_block_timestamp(arena_address);

    assert_eq!(token.balance_of(adapter.contract_address), 25 * UNIT);

    start_cheat_caller_address(adapter.contract_address, POOL1);
    let got1 = adapter.withdraw('R1');
    stop_cheat_caller_address(adapter.contract_address);
    start_cheat_caller_address(adapter.contract_address, POOL2);
    let got2 = adapter.withdraw('R2');
    stop_cheat_caller_address(adapter.contract_address);

    assert_eq!(got1, 20 * UNIT);
    assert_eq!(got2, 5 * UNIT);
    assert_eq!(token.balance_of(POOL1), 100 * UNIT);
    assert_eq!(token.balance_of(POOL2), 100 * UNIT);
    assert_eq!(token.balance_of(adapter.contract_address), Zero::zero());
}

#[test]
#[should_panic(expected: ('NO_CUSTODY',))]
fn test_cross_pool_withdraw_panics() {
    let (token, arena, adapter, token_address, arena_address) = setup();

    fund_and_register(
        token, arena, token_address, arena_address, adapter.contract_address,
        POOL1, COMMITMENT, 100 * UNIT,
    );
    token.mint(POOL2, 100 * UNIT);
    start_cheat_caller_address(token_address, POOL2);
    token.approve(adapter.contract_address, 100 * UNIT);
    stop_cheat_caller_address(token_address);

    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    adapter.execute_action('R1', COMMITMENT, token_address, TARGET, 20_u128, 1000_u128, 980_u128, 200_u16);
    stop_cheat_caller_address(adapter.contract_address);
    stop_cheat_block_timestamp(arena_address);

    // POOL2 tries to walk off with POOL1's custody — must revert.
    start_cheat_caller_address(adapter.contract_address, POOL2);
    adapter.withdraw('R1');
}

#[test]
#[should_panic(expected: ('NO_CUSTODY',))]
fn test_double_withdraw_panics() {
    let (token, arena, adapter, token_address, arena_address) = setup();

    fund_and_register(
        token, arena, token_address, arena_address, adapter.contract_address,
        POOL1, COMMITMENT, 100 * UNIT,
    );

    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    adapter.execute_action('R1', COMMITMENT, token_address, TARGET, 20_u128, 1000_u128, 980_u128, 200_u16);
    stop_cheat_block_timestamp(arena_address);
    let _ = adapter.withdraw('R1');
    adapter.withdraw('R1'); // second pull — must revert
}

#[test]
fn test_rejected_verdict_still_records_refundable_custody() {
    let (token, arena, adapter, token_address, arena_address) = setup();

    // No strategy registered for 'GHOST' → Arena rejects, but capital delivered.
    token.mint(POOL1, 100 * UNIT);
    start_cheat_caller_address(token_address, POOL1);
    token.approve(adapter.contract_address, 100 * UNIT);
    stop_cheat_caller_address(token_address);

    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    let verdict = adapter.execute_action('RG', 'GHOST_COMMIT', token_address, TARGET, 7_u128, 1000_u128, 993_u128, 70_u16);
    stop_cheat_caller_address(adapter.contract_address);
    stop_cheat_block_timestamp(arena_address);

    assert_eq!(verdict, reason::UNREGISTERED);
    let (_, custody_amount) = adapter.get_custody(POOL1, 'RG');
    assert_eq!(custody_amount, 7 * UNIT);

    // Reclaimable in full by its own pool.
    start_cheat_caller_address(adapter.contract_address, POOL1);
    let got = adapter.withdraw('RG');
    stop_cheat_caller_address(adapter.contract_address);
    assert_eq!(got, 7 * UNIT);
    assert_eq!(token.balance_of(POOL1), 100 * UNIT);
}

#[test]
#[should_panic(expected: ('INSUFFICIENT_ALLOWANCE',))]
fn test_unapproved_pool_cannot_deliver() {
    let (token, arena, adapter, token_address, arena_address) = setup();

    token.mint(POOL1, 100 * UNIT); // funded but NEVER approved

    start_cheat_block_timestamp(arena_address, 1500);
    start_cheat_caller_address(adapter.contract_address, POOL1);
    adapter.execute_action('RX', COMMITMENT, token_address, TARGET, 20_u128, 1000_u128, 980_u128, 200_u16);
}
