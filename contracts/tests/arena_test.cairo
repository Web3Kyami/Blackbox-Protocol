use blackbox_arena_contracts::arena::{
    IArenaDispatcher, IArenaDispatcherTrait, reason,
};
use blackbox_arena_contracts::mock_prize_token::{
    IMockPrizeTokenDispatcher, IMockPrizeTokenDispatcherTrait,
};
use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};

const START: u64 = 1_000;
const END: u64 = 2_000;
const AMARA: ContractAddress = 'AMARA'.try_into().unwrap();
const ADAPTER: ContractAddress = 'ADAPTER'.try_into().unwrap();
const ASSET: ContractAddress = 'TEST_USD'.try_into().unwrap();
const TARGET: ContractAddress = 'MOCK_EXECUTOR'.try_into().unwrap();
const FALCON: felt252 = 'FALCON_COMMIT';
const TORTOISE: felt252 = 'TORTOISE_COMMIT';
const PULSE: felt252 = 'PULSE_COMMIT';
const OTHER: ContractAddress = 'OTHER_USER'.try_into().unwrap();
const ASSET2: ContractAddress = 'SECOND_ASSET'.try_into().unwrap();
const TARGET2: ContractAddress = 'SECOND_TARGET'.try_into().unwrap();

fn deploy_arena_raw_with_prize(prize: ContractAddress) -> (ContractAddress, IArenaDispatcher) {
    let contract = declare("Arena").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(
            @array![
                AMARA.into(),
                START.into(),
                END.into(),
                1_000_u128.into(),
                3_500_u16.into(),
                2_000_u16.into(),
                100_u128.into(),
                prize.into(),
                // initial_assets: Span<ContractAddress> serialized as [len, elem...]
                1.into(),
                ASSET.into(),
                // initial_targets: Span<ContractAddress> serialized as [len, elem...]
                1.into(),
                TARGET.into(),
                'RULES_V1',
            ],
        )
        .unwrap_syscall();
    (address, IArenaDispatcher { contract_address: address })
}

fn deploy_arena_raw() -> (ContractAddress, IArenaDispatcher) {
    deploy_arena_raw_with_prize(ASSET)
}

fn deploy_arena_with_prize(prize: ContractAddress) -> (ContractAddress, IArenaDispatcher) {
    let (address, arena) = deploy_arena_raw_with_prize(prize);
    start_cheat_block_timestamp(address, START - 1);
    start_cheat_caller_address(address, AMARA);
    arena.set_price(ASSET, 1_000_000_000_000_000_000); // 1.0 in 18 decimals
    arena.set_action_adapter(ADAPTER);
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);
    (address, arena)
}

fn deploy_arena() -> (ContractAddress, IArenaDispatcher) {
    deploy_arena_with_prize(ASSET)
}

fn deploy_prize_token() -> IMockPrizeTokenDispatcher {
    let class = declare("MockPrizeToken").unwrap_syscall().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap_syscall();
    IMockPrizeTokenDispatcher { contract_address: address }
}

fn submit(
    address: ContractAddress,
    arena: IArenaDispatcher,
    receipt: felt252,
    strategy: felt252,
    allocation: u128,
    before: u128,
    after: u128,
    drawdown: u16,
) -> felt252 {
    submit_with_asset_target(
        address, arena, receipt, strategy, ASSET, TARGET, allocation, before, after, drawdown,
    )
}

fn submit_with_asset_target(
    address: ContractAddress,
    arena: IArenaDispatcher,
    receipt: felt252,
    strategy: felt252,
    asset: ContractAddress,
    target: ContractAddress,
    allocation: u128,
    before: u128,
    after: u128,
    drawdown: u16,
) -> felt252 {
    start_cheat_caller_address(address, ADAPTER);
    let result = arena
        .submit_action(
            receipt_id: receipt,
            strategy_commitment: strategy,
            asset: asset,
            target: target,
            allocation_units: allocation,
            portfolio_value_before: before,
            portfolio_value_after: after,
            drawdown_bps: drawdown,
        );
    stop_cheat_caller_address(address);
    result
}

#[test]
fn test_set_action_adapter_success() {
    let (address, arena) = deploy_arena_raw();
    assert_eq!(arena.get_action_adapter(), Zero::zero());
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter(ADAPTER);
    stop_cheat_caller_address(address);
    assert_eq!(arena.get_action_adapter(), ADAPTER);
}

#[test]
#[should_panic(expected: ('ONLY_SPONSOR',))]
fn test_set_action_adapter_unauthorized_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, OTHER);
    arena.set_action_adapter(ADAPTER);
}

#[test]
#[should_panic(expected: ('BAD_ADAPTER',))]
fn test_set_action_adapter_zero_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter(Zero::zero());
}

#[test]
#[should_panic(expected: ('ADAPTER_SET',))]
fn test_set_action_adapter_second_assignment_panics() {
    let (address, arena) = deploy_arena();
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter('NEW_ADAPTER'.try_into().unwrap());
}

#[test]
#[should_panic(expected: ('BAD_TIME',))]
fn test_set_action_adapter_after_start_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_block_timestamp(address, START);
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter(ADAPTER);
}

#[test]
#[should_panic(expected: ('REG_CLOSED',))]
fn test_set_action_adapter_after_registration_panics() {
    let (address, arena) = deploy_arena_raw();
    arena.register_strategy(FALCON);
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter(ADAPTER);
}

#[test]
fn test_add_allowed_asset_and_target() {
    let (address, arena) = deploy_arena_raw();

    assert!(arena.is_asset_allowed(ASSET));
    assert!(!arena.is_asset_allowed(ASSET2));
    assert!(arena.is_target_allowed(TARGET));
    assert!(!arena.is_target_allowed(TARGET2));

    start_cheat_caller_address(address, AMARA);
    arena.add_allowed_asset(ASSET2);
    arena.add_allowed_target(TARGET2);
    stop_cheat_caller_address(address);

    assert!(arena.is_asset_allowed(ASSET2));
    assert!(arena.is_target_allowed(TARGET2));
}

#[test]
fn test_set_price_success() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.set_price(ASSET, 500);
    stop_cheat_caller_address(address);
    assert_eq!(arena.get_price(ASSET), 500);
    assert_eq!(arena.get_price_timestamp(ASSET), 0);
}

#[test]
#[should_panic(expected: ('ONLY_SPONSOR',))]
fn test_set_price_unauthorized_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, OTHER);
    arena.set_price(ASSET, 100);
}

#[test]
#[should_panic(expected: ('BAD_ASSET',))]
fn test_set_price_unallowed_asset_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.set_price(ASSET2, 100);
}

#[test]
#[should_panic(expected: ('BAD_RULES',))]
fn test_set_price_zero_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.set_price(ASSET, 0);
}

#[test]
#[should_panic(expected: ('BAD_TIME',))]
fn test_set_price_after_start_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_block_timestamp(address, START);
    start_cheat_caller_address(address, AMARA);
    arena.set_price(ASSET, 100);
}

#[test]
fn test_submit_action_without_price_rejected_stale_price() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.set_action_adapter(ADAPTER);
    // Do NOT set price for ASSET
    stop_cheat_caller_address(address);
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);
    assert_eq!(
        submit(address, arena, 'NO_PRICE', FALCON, 100, 1_000, 1_010, 100),
        reason::STALE_PRICE,
    );
    stop_cheat_block_timestamp(address);
}

#[test]
#[should_panic(expected: ('ONLY_SPONSOR',))]
fn test_add_asset_unauthorized_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, OTHER);
    arena.add_allowed_asset(ASSET2);
}

#[test]
#[should_panic(expected: ('DUP_ASSET',))]
fn test_add_duplicate_asset_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.add_allowed_asset(ASSET);
}

#[test]
#[should_panic(expected: ('DUP_TARGET',))]
fn test_add_duplicate_target_panics() {
    let (address, arena) = deploy_arena_raw();
    start_cheat_caller_address(address, AMARA);
    arena.add_allowed_target(TARGET);
}

#[test]
fn test_case_study_derives_tortoise_winner() {
    let token = deploy_prize_token();
    let (address, arena) = deploy_arena_with_prize(token.contract_address);
    arena.register_strategy(FALCON);
    arena.register_strategy(TORTOISE);
    arena.register_strategy(PULSE);

    start_cheat_block_timestamp(address, START + 1);
    assert_eq!(submit(address, arena, 'FALCON_BIG', FALCON, 700, 1_000, 1_300, 0), reason::ALLOCATION);
    assert_eq!(submit(address, arena, 'FALCON_OK', FALCON, 300, 1_000, 1_010, 200), reason::ACCEPTED);
    assert_eq!(submit(address, arena, 'TORTOISE_OK', TORTOISE, 350, 1_000, 1_120, 800), reason::ACCEPTED);
    assert_eq!(submit(address, arena, 'PULSE_OK', PULSE, 350, 1_000, 1_180, 2_500), reason::ACCEPTED);
    stop_cheat_block_timestamp(address);

    let falcon = arena.get_score(FALCON);
    assert_eq!(falcon.final_value, 1_010);
    assert_eq!(falcon.return_bps, 100);
    assert_eq!(falcon.max_drawdown_bps, 200);
    assert!(falcon.eligible);
    assert_eq!(falcon.score_bps, -100);

    let tortoise = arena.get_score(TORTOISE);
    assert_eq!(tortoise.final_value, 1_120);
    assert_eq!(tortoise.return_bps, 1_200);
    assert_eq!(tortoise.max_drawdown_bps, 800);
    assert!(tortoise.eligible);
    assert_eq!(tortoise.score_bps, 400);

    let pulse = arena.get_score(PULSE);
    assert_eq!(pulse.final_value, 1_180);
    assert_eq!(pulse.return_bps, 1_800);
    assert_eq!(pulse.max_drawdown_bps, 2_500);
    assert!(!pulse.eligible);
    assert_eq!(pulse.score_bps, 0);

    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);
    assert_eq!(arena.get_winner(), TORTOISE);

    // Sponsor funds the escrowed prize before settling (P4.3).
    // `token` here is the same mock that was passed to the Arena constructor.
    token.mint(AMARA, 500);
    start_cheat_caller_address(token.contract_address, AMARA);
    token.approve(address, 500);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.deposit_prize(100);
    assert_eq!(arena.settle(100), TORTOISE);
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);
    assert_eq!(arena.get_settlement(), (TORTOISE, 100));
}

#[test]
fn test_tie_break_drawdown_and_registration_order() {
    let (address, arena) = deploy_arena();
    let strat_a: felt252 = 'STRAT_A';
    let strat_b: felt252 = 'STRAT_B';
    let strat_c: felt252 = 'STRAT_C';

    arena.register_strategy(strat_a); // order 1
    arena.register_strategy(strat_b); // order 2
    arena.register_strategy(strat_c); // order 3

    start_cheat_block_timestamp(address, START + 1);
    // A and B both get score 500 bps:
    // A: return 1000 bps, drawdown 500 bps -> score 500 bps
    // B: return 800 bps, drawdown 300 bps -> score 500 bps (lower drawdown, should beat A)
    assert_eq!(submit(address, arena, 'R_A', strat_a, 100, 1_000, 1_100, 500), reason::ACCEPTED);
    assert_eq!(submit(address, arena, 'R_B', strat_b, 100, 1_000, 1_080, 300), reason::ACCEPTED);
    // C: same score 500 bps, same drawdown 300 bps as B, but registered later (order 3 vs 2) -> B beats C
    assert_eq!(submit(address, arena, 'R_C', strat_c, 100, 1_000, 1_080, 300), reason::ACCEPTED);
    stop_cheat_block_timestamp(address);

    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);

    assert_eq!(arena.get_winner(), strat_b);
}

#[test]
fn test_integer_return_basis_points_truncation() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);

    start_cheat_block_timestamp(address, START + 1);
    // starting: 1000. final: 1003. return = (1003 - 1000) * 10000 / 1000 = 30 bps.
    assert_eq!(submit(address, arena, 'R_POS', FALCON, 100, 1_000, 1_003, 0), reason::ACCEPTED);
    stop_cheat_block_timestamp(address);

    let score = arena.get_score(FALCON);
    assert_eq!(score.return_bps, 30);
}

#[test]
fn test_replay_is_blocked() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);

    assert_eq!(submit(address, arena, 'ONCE', FALCON, 100, 1_000, 1_010, 100), reason::ACCEPTED);
    assert_eq!(submit(address, arena, 'ONCE', FALCON, 100, 1_010, 1_020, 100), reason::DUPLICATE);

    stop_cheat_block_timestamp(address);
}

#[test]
fn test_multi_asset_submission() {
    let (address, arena) = deploy_arena();
    start_cheat_block_timestamp(address, START - 1);
    start_cheat_caller_address(address, AMARA);
    arena.add_allowed_asset(ASSET2);
    arena.add_allowed_target(TARGET2);
    arena.set_price(ASSET2, 2_000_000_000_000_000_000); // 2.0 in 18 decimals
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);

    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);

    // Submit on the original asset/target pair
    assert_eq!(submit(address, arena, 'R1', FALCON, 100, 1_000, 1_010, 100), reason::ACCEPTED);
    // Submit on the second asset but original target - should be accepted since both are allowed
    assert_eq!(
        submit_with_asset_target(
            address, arena, 'R2', FALCON, ASSET2, TARGET, 50, 1_010, 1_040, 200,
        ),
        reason::ACCEPTED,
    );
    // Submit on second target too
    assert_eq!(
        submit_with_asset_target(
            address,
            arena,
            'R3',
            FALCON,
            ASSET2,
            TARGET2,
            30,
            1_040,
            1_060,
            150,
        ),
        reason::ACCEPTED,
    );
    // Unknown asset should still be rejected
    assert_eq!(
        submit_with_asset_target(
            address,
            arena,
            'R4',
            FALCON,
            'UNKNOWN_ASSET'.try_into().unwrap(),
            TARGET,
            10,
            1_060,
            1_065,
            0,
        ),
        reason::BAD_ASSET,
    );

    stop_cheat_block_timestamp(address);

    let score = arena.get_score(FALCON);
    assert_eq!(score.final_value, 1_060);
}

#[test]
fn test_validation_reason_codes() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);
    start_cheat_caller_address(address, ADAPTER);
    assert_eq!(
        arena.submit_action('UNKNOWN', TORTOISE, ASSET, TARGET, 1, 1_000, 1_001, 0),
        reason::UNREGISTERED,
    );
    assert_eq!(
        arena.submit_action(
            'BAD_ASSET', FALCON, 'OTHER_ASSET'.try_into().unwrap(), TARGET, 1, 1_000, 1_001, 0,
        ),
        reason::BAD_ASSET,
    );
    assert_eq!(
        arena.submit_action(
            'BAD_TARGET', FALCON, ASSET, 'OTHER_TARGET'.try_into().unwrap(), 1, 1_000, 1_001, 0,
        ),
        reason::BAD_TARGET,
    );
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);
}

#[test]
#[should_panic(expected: ('ONLY_ADAPTER',))]
fn test_unauthorized_action_caller_panics() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);
    arena.submit_action('ATTACK', FALCON, ASSET, TARGET, 1, 1_000, 1_001, 0);
}

#[test]
#[should_panic(expected: ('PRIZE_CAP',))]
fn test_settlement_over_cap_panics() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    arena.settle(101);
}

#[test]
fn test_rejected_non_duplicate_receipt_is_consumed() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);

    // 9000/1000 = 9000 bps exceeds the 3500 bps allocation limit: rejected.
    assert_eq!(submit(address, arena, 'REUSE_ME', FALCON, 9_000, 1_000, 2_000, 0), reason::ALLOCATION);
    // D003: the rejected non-duplicate receipt is consumed. Replaying the same ID
    // with altered (valid) fields must not be accepted.
    assert_eq!(submit(address, arena, 'REUSE_ME', FALCON, 100, 1_000, 1_010, 0), reason::DUPLICATE);

    stop_cheat_block_timestamp(address);

    let score = arena.get_score(FALCON);
    assert_eq!(score.final_value, 1_000);
    // Both the original rejection and the duplicate replay count as rejected
    // actions, matching the JavaScript engine's submitAction accounting.
    let (accepted, rejected) = arena.get_action_counts(FALCON);
    assert_eq!(accepted, 0);
    assert_eq!(rejected, 2);
}

#[test]
fn test_unregistered_receipt_consumed() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(TORTOISE);
    start_cheat_block_timestamp(address, START + 1);

    assert_eq!(
        submit(address, arena, 'GHOST_R', FALCON, 100, 1_000, 1_010, 0),
        reason::UNREGISTERED
    );
    // The consumed receipt ID cannot be re-pointed at a registered strategy.
    assert_eq!(
        submit(address, arena, 'GHOST_R', TORTOISE, 100, 1_000, 1_010, 0),
        reason::DUPLICATE
    );

    stop_cheat_block_timestamp(address);
    assert_eq!(arena.get_score(TORTOISE).final_value, 1_000);
}

#[test]
fn test_action_after_end_rejected_and_counted() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, END + 1);
    assert_eq!(submit(address, arena, 'LATE', FALCON, 100, 1_000, 1_010, 0), reason::CLOSED);
    stop_cheat_block_timestamp(address);

    let (accepted, rejected) = arena.get_action_counts(FALCON);
    assert_eq!(accepted, 0);
    assert_eq!(rejected, 1);
}

#[test]
fn test_action_after_explicit_close_rejected_and_counted() {
    let (address, arena) = deploy_arena();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, START + 1);
    assert_eq!(submit(address, arena, 'IN_TIME', FALCON, 100, 1_000, 1_010, 0), reason::ACCEPTED);
    stop_cheat_block_timestamp(address);

    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);

    start_cheat_block_timestamp(address, END + 5);
    assert_eq!(
        submit(address, arena, 'AFTER_CLOSE', FALCON, 100, 1_010, 1_020, 0),
        reason::CLOSED
    );
    stop_cheat_block_timestamp(address);

    let (accepted, rejected) = arena.get_action_counts(FALCON);
    assert_eq!(accepted, 1);
    assert_eq!(rejected, 1);
}

#[test]
#[should_panic(expected: ('REG_CLOSED',))]
fn test_registration_at_exact_start_panics() {
    let (address, arena) = deploy_arena();
    start_cheat_block_timestamp(address, START);
    arena.register_strategy(TORTOISE);
}

#[test]
fn test_registration_one_second_before_start_succeeds() {
    let (address, arena) = deploy_arena();
    start_cheat_block_timestamp(address, START - 1);
    arena.register_strategy(TORTOISE);
    stop_cheat_block_timestamp(address);
    assert_eq!(arena.get_score(TORTOISE).registration_order, 1);
}

#[test]
fn test_zero_action_strategy_scores_neutral() {
    let (_, arena) = deploy_arena();
    arena.register_strategy(TORTOISE);
    let score = arena.get_score(TORTOISE);
    assert_eq!(score.final_value, 1_000);
    assert_eq!(score.return_bps, 0);
    assert_eq!(score.max_drawdown_bps, 0);
    assert!(score.eligible);
    assert_eq!(score.score_bps, 0);
    assert_eq!(score.registration_order, 1);
}

#[test]
fn test_registrant_is_bound_at_registration() {
    let (address, arena) = deploy_arena();
    // Registration is permissionless before start: any account binds itself.
    start_cheat_caller_address(address, OTHER);
    arena.register_strategy(TORTOISE);
    stop_cheat_caller_address(address);
    assert_eq!(arena.get_registrant(TORTOISE), OTHER);

    start_cheat_caller_address(address, AMARA);
    arena.register_strategy(FALCON);
    stop_cheat_caller_address(address);
    assert_eq!(arena.get_registrant(FALCON), AMARA);
    assert_ne!(arena.get_registrant(FALCON), arena.get_registrant(TORTOISE));
}

#[test]
fn test_unknown_commitment_has_zero_registrant() {
    let (_, arena) = deploy_arena();
    assert_eq!(
        arena.get_registrant('NEVER_SEEN'),
        Zero::zero()
    );
}

#[test]
fn test_deposit_and_settle_pay_registrant() {
    let token = deploy_prize_token();
    let (address, arena) = deploy_arena_with_prize(token.contract_address);

    // Tortoise registers itself from a non-sponsor account: the registrant,
    // not the sponsor, must receive the prize.
    start_cheat_caller_address(address, OTHER);
    arena.register_strategy(TORTOISE);
    stop_cheat_caller_address(address);
    arena.register_strategy(PULSE);

    start_cheat_block_timestamp(address, START + 1);
    assert_eq!(submit(address, arena, 'T_OK', TORTOISE, 350, 1_000, 1_120, 800), reason::ACCEPTED);
    // Pulse accepts an action but exceeds the drawdown limit: ineligible.
    assert_eq!(submit(address, arena, 'P_OK', PULSE, 350, 1_000, 1_180, 2_500), reason::ACCEPTED);
    stop_cheat_block_timestamp(address);

    token.mint(AMARA, 500);
    // Approve as AMARA against the token contract (cheat targets the token).
    start_cheat_caller_address(token.contract_address, AMARA);
    token.approve(address, 300);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    arena.deposit_prize(100);
    stop_cheat_caller_address(address);
    stop_cheat_block_timestamp(address);

    assert_eq!(arena.get_prize_deposited(), 100);
    assert_eq!(token.balance_of(address), 100);

    start_cheat_caller_address(address, AMARA);
    assert_eq!(arena.settle(100), TORTOISE);
    stop_cheat_caller_address(address);

    assert_eq!(arena.get_settlement(), (TORTOISE, 100));
    assert_eq!(token.balance_of(address), 0);
    assert_eq!(token.balance_of(OTHER), 100);
}

#[test]
#[should_panic(expected: ('NO_PRIZE',))]
fn test_settle_without_funded_prize_panics() {
    let token = deploy_prize_token();
    let (address, arena) = deploy_arena_with_prize(token.contract_address);
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(address, END);
    start_cheat_caller_address(address, AMARA);
    arena.close();
    arena.settle(50);
}

#[test]
#[should_panic(expected: ('ONLY_SPONSOR',))]
fn test_deposit_prize_unauthorized_panics() {
    let (address, arena) = deploy_arena();
    start_cheat_caller_address(address, OTHER);
    arena.deposit_prize(10);
}

#[test]
#[should_panic(expected: ('BAD_RULES',))]
fn test_deposit_prize_zero_panics() {
    let (address, arena) = deploy_arena();
    start_cheat_caller_address(address, AMARA);
    arena.deposit_prize(0);
}

#[test]
fn test_get_prize_token_view() {
    let (_, arena) = deploy_arena();
    assert_eq!(arena.get_prize_token(), ASSET);
}
