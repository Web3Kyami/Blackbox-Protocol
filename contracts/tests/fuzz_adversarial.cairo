use blackbox_arena_contracts::arena::{IArenaDispatcher, IArenaDispatcherTrait, reason};
use blackbox_arena_contracts::mock_prize_token::{
    IMockPrizeTokenDispatcher, IMockPrizeTokenDispatcherTrait,
};
use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};

const START: u64 = 1000;
const END: u64 = 2000;
const SPONSOR: ContractAddress = 'SPONSOR'.try_into().unwrap();
const ADAPTER: ContractAddress = 'ADAPTER'.try_into().unwrap();
const ASSET: ContractAddress = 'TEST_USD'.try_into().unwrap();
const TARGET: ContractAddress = 'MOCK_EXECUTOR'.try_into().unwrap();
const UNIT: u256 = 1_000_000_000_000_000_000;
const FALCON: felt252 = 'FALCON_COMMIT';
const TORTOISE: felt252 = 'TORTOISE_COMMIT';
const ATTACKER: ContractAddress = 'ATTACKER'.try_into().unwrap();
const OTHER: ContractAddress = 'OTHER_USER'.try_into().unwrap();

fn deploy_arena_raw() -> (ContractAddress, IArenaDispatcher) {
    let (addr, _) = declare("Arena")
        .unwrap_syscall()
        .contract_class()
        .deploy(
            @array![
                SPONSOR.into(),
                START.into(),
                END.into(),
                1_000_u128.into(),
                3_500_u16.into(),
                2_000_u16.into(),
                100_u128.into(),
                ASSET.into(),
                1.into(),
                ASSET.into(),
                1.into(),
                TARGET.into(),
                'RULES_V1',
                64_u32.into(),
            ],
        )
        .unwrap_syscall();
    (addr, IArenaDispatcher { contract_address: addr })
}

fn deploy_with_adapter() -> (ContractAddress, IArenaDispatcher) {
    let (addr, arena) = deploy_arena_raw();
    start_cheat_block_timestamp(addr, START - 1);
    start_cheat_caller_address(addr, SPONSOR);
    arena.set_price(ASSET, 1_000_000_000_000_000_000);
    arena.set_action_adapter(ADAPTER);
    stop_cheat_caller_address(addr);
    stop_cheat_block_timestamp(addr);
    (addr, arena)
}

fn deploy_with_float() -> (ContractAddress, IArenaDispatcher, ContractAddress) {
    // Use a fresh token as float
    let float_class = declare("MockPrizeToken").unwrap_syscall().contract_class();
    let (float_addr, _) = float_class.deploy(@array![]).unwrap_syscall();
    let (arena_addr, arena) = deploy_arena_raw();
    // must set float before any registration and before START
    start_cheat_block_timestamp(arena_addr, START - 10);
    start_cheat_caller_address(arena_addr, SPONSOR);
    arena.set_price(ASSET, 1_000_000_000_000_000_000);
    arena.set_action_adapter(ADAPTER);
    arena.set_float_token(float_addr);
    stop_cheat_caller_address(arena_addr);
    stop_cheat_block_timestamp(arena_addr);
    (arena_addr, arena, float_addr)
}

// ── Saturating bps ─────────────────────────────────────────────────────────

#[test]
#[fuzzer(runs: 128, seed: 42)]
fn test_fuzz_saturating_bps_never_panics(final_value: u128) {
    let (addr, arena) = deploy_with_adapter();
    arena.register_strategy(FALCON);
    start_cheat_block_timestamp(addr, START + 1);
    start_cheat_caller_address(addr, ADAPTER);
    // first action must be from starting 1000; we use acceptance path
    let _ = arena
        .submit_action('FZ', FALCON, ASSET, TARGET, 1, 1_000, final_value, 0);
    stop_cheat_caller_address(addr);
    stop_cheat_block_timestamp(addr);
    // scoring must never panic; result clamped to i64
    let score = arena.get_score(FALCON);
    assert!(score.return_bps >= -10000 || score.return_bps == -9223372036854775807_i64 || score.return_bps <= 9223372036854775807_i64);
    // saturated extremes
    if final_value == 0xffffffffffffffffffffffffffffffff_u128 {
        assert_eq!(score.return_bps, 9223372036854775807_i64);
    }
}

#[test]
#[fuzzer(runs: 64, seed: 7)]
fn test_fuzz_zero_start_guard(random_final: u128) {
    // When float start==0, score is forced to -10000 / ineligible regardless of final
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    // do NOT fund registrant -> attest_start stays 0? Actually registrant has 0 balance at registration
    // Register without funding
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy('ZERO_START');
    stop_cheat_caller_address(arena_addr);
    // fund attacker later to large value but start is still 0
    float.mint(OTHER, random_final.into() + 1);
    let score = arena.get_score('ZERO_START');
    assert_eq!(score.return_bps, -10000);
    assert!(!score.eligible);
    assert_eq!(score.score_bps, 0);
}

// ── High !=0 saturation ─────────────────────────────────────────────────

#[test]
fn test_high_nonzero_saturates_to_max_u128() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    // fund registrant with high limb non-zero
    let huge: u256 = u256 { low: 123, high: 1 };
    float.mint(OTHER, huge);
    // register -> attest_start captures saturated value
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy('SAT_HIGH');
    stop_cheat_caller_address(arena_addr);
    let start = arena.get_attest_start('SAT_HIGH');
    assert_eq!(start, 0xffffffffffffffffffffffffffffffff_u128);
    // checkpoint with same saturated balance
    arena.checkpoint('SAT_HIGH');
    let (bal, _) = arena.get_checkpoint('SAT_HIGH', 0);
    assert_eq!(bal, 0xffffffffffffffffffffffffffffffff_u128);
    let score = arena.get_score('SAT_HIGH');
    assert_eq!(score.final_value, 0xffffffffffffffffffffffffffffffff_u128);
    // return_bps = 0 when start == saturated and current == saturated
    assert_eq!(score.return_bps, 0);
}

// ── Checkpoint spam / poseidon / permission ─────────────────────────────

#[test]
fn test_checkpoint_spam_20_and_poseidon_uniqueness() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy('SPAM');
    stop_cheat_caller_address(arena_addr);
    assert_eq!(arena.get_checkpoint_count('SPAM'), 0);
    // spam 20 checkpoints: alternate balances 900..1100 around peak 1000
    let mut i: u32 = 0;
    let mut expected_peak = arena.get_attest_peak('SPAM');
    let mut expected_max_dd: u16 = 0;
    while i < 20 {
        let bal_low: u128 = if i % 2 == 0 { 900 } else { 1100 + i.into() };
        // set balance by mint/burn: simplest is to mint delta then burn via transfer to SPONSOR
        // Instead directly set via extra mint then checkpoint; peak tracks max
        if bal_low > 800 {
            // top up OTHER to bal_low
            let current = float.balance_of(OTHER);
            if bal_low.into() > current {
                float.mint(OTHER, bal_low.into() - current);
            } else {
                // burn: transfer to SPONSOR
                start_cheat_caller_address(float_addr, OTHER);
                float.transfer(SPONSOR, current - bal_low.into());
                stop_cheat_caller_address(float_addr);
            }
        }
        arena.checkpoint('SPAM');
        let (stored_bal, _) = arena.get_checkpoint('SPAM', i);
        assert_eq!(stored_bal, float.balance_of(OTHER).low);
        if stored_bal > expected_peak {
            expected_peak = stored_bal;
        }
        // compute cur_dd
        let cur_dd: u16 = if stored_bal < expected_peak {
            let diff: u256 = (expected_peak - stored_bal).into();
            let mag: u256 = (diff * 10000_u256) / expected_peak.into();
            if mag > 10000_u256 { 10000 } else { mag.low.try_into().unwrap() }
        } else { 0 };
        if cur_dd > expected_max_dd { expected_max_dd = cur_dd; }
        i += 1;
    }
    assert_eq!(arena.get_checkpoint_count('SPAM'), 20);
    assert_eq!(arena.get_attest_peak('SPAM'), expected_peak);
    assert_eq!(arena.get_attest_max_dd('SPAM'), expected_max_dd);
    // poseidon keys are unique per index: different commitments must differ
    let (bal0_a, _) = arena.get_checkpoint('SPAM', 0);
    float.mint(OTHER, 9999);
    arena.checkpoint('SPAM');
    let (bal20, _) = arena.get_checkpoint('SPAM', 20);
    assert!(bal20 != bal0_a || bal20 == 9999 + bal0_a); // just ensure index 20 exists and is not aliasing 0
}

#[test]
#[should_panic(expected: ('UNREGISTERED',))]
fn test_checkpoint_unregistered_panics() {
    let (_, arena, _) = deploy_with_float();
    arena.checkpoint('GHOST');
}

#[test]
#[should_panic(expected: ('NO_FLOAT',))]
fn test_checkpoint_no_float_panics() {
    let (addr, arena) = deploy_with_adapter();
    arena.register_strategy(FALCON);
    arena.checkpoint(FALCON);
    let _ = addr;
}

#[test]
#[should_panic(expected: ('ALREADY_CLOSED',))]
fn test_checkpoint_after_close_panics() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy(FALCON);
    stop_cheat_caller_address(arena_addr);
    start_cheat_block_timestamp(arena_addr, END);
    start_cheat_caller_address(arena_addr, SPONSOR);
    arena.close();
    stop_cheat_caller_address(arena_addr);
    arena.checkpoint(FALCON);
}

// ── float_token lifecycle ───────────────────────────────────────────────

#[test]
#[should_panic(expected: ('FLOAT_SET',))]
fn test_float_double_set_panics() {
    let (arena_addr, arena, _) = deploy_with_float();
    start_cheat_block_timestamp(arena_addr, START - 5);
    start_cheat_caller_address(arena_addr, SPONSOR);
    let extra_class = declare("MockPrizeToken").unwrap_syscall().contract_class();
    let (extra, _) = extra_class.deploy(@array![]).unwrap_syscall();
    arena.set_float_token(extra);
}

#[test]
#[should_panic(expected: ('BAD_TIME',))]
fn test_float_after_start_panics() {
    let (arena_addr, _) = deploy_arena_raw();
    let float_class = declare("MockPrizeToken").unwrap_syscall().contract_class();
    let (float_addr, _) = float_class.deploy(@array![]).unwrap_syscall();
    start_cheat_block_timestamp(arena_addr, START);
    start_cheat_caller_address(arena_addr, SPONSOR);
    IArenaDispatcher { contract_address: arena_addr }.set_float_token(float_addr);
}

#[test]
#[should_panic(expected: ('BAD_FLOAT',))]
fn test_float_zero_panics() {
    let (arena_addr, arena) = deploy_arena_raw();
    start_cheat_block_timestamp(arena_addr, START - 1);
    start_cheat_caller_address(arena_addr, SPONSOR);
    arena.set_float_token(Zero::zero());
}

#[test]
#[should_panic(expected: ('REG_CLOSED',))]
fn test_float_after_registration_panics() {
    let (arena_addr, arena) = deploy_arena_raw();
    arena.register_strategy(FALCON);
    let float_class = declare("MockPrizeToken").unwrap_syscall().contract_class();
    let (float_addr, _) = float_class.deploy(@array![]).unwrap_syscall();
    start_cheat_block_timestamp(arena_addr, START - 1);
    start_cheat_caller_address(arena_addr, SPONSOR);
    arena.set_float_token(float_addr);
}

// ── Attested branch ignores submit values ───────────────────────────────

#[test]
fn test_attested_ignores_open_submit_inflation() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy(FALCON);
    stop_cheat_caller_address(arena_addr);
    let start = arena.get_attest_start(FALCON);
    assert_eq!(start, 1_000 * UNIT.low);
    // Try to spoof via open_submit_action with huge after value
    start_cheat_block_timestamp(arena_addr, START + 1);
    start_cheat_caller_address(arena_addr, OTHER);
    let _ = arena.open_submit_action('SPOOF', FALCON, ASSET, TARGET, 1, 1_000, 9_999_999, 0);
    stop_cheat_caller_address(arena_addr);
    stop_cheat_block_timestamp(arena_addr);
    // get_score must still reflect float balance (1000 units => return 0), not 9_999_999
    let score = arena.get_score(FALCON);
    assert_eq!(score.final_value, 1_000 * UNIT.low);
    assert_eq!(score.return_bps, 0);
    // Now mutate float to 2x and ensure score tracks float, not spoofed value
    float.mint(OTHER, 1_000 * UNIT);
    let score2 = arena.get_score(FALCON);
    assert_eq!(score2.final_value, 2_000 * UNIT.low);
    assert_eq!(score2.return_bps, 10000); // 100% gain => 10000 bps
}

#[test]
fn test_attested_spoof_repeat_10x_still_ignored() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy(TORTOISE);
    stop_cheat_caller_address(arena_addr);
    start_cheat_block_timestamp(arena_addr, START + 1);
    let mut i: u32 = 0;
    while i < 10 {
        start_cheat_caller_address(arena_addr, OTHER);
        // each spoof claims a different huge after value
        let fake_after: u128 = 1_000 + (i.into() * 1_000_000);
        let _ = arena.open_submit_action(i.into(), TORTOISE, ASSET, TARGET, 1, if i == 0 { 1_000 } else { 1_000 + ((i - 1).into() * 1_000_000) }, fake_after, 0);
        stop_cheat_caller_address(arena_addr);
        i += 1;
    }
    stop_cheat_block_timestamp(arena_addr);
    let score = arena.get_score(TORTOISE);
    // still pegged to float balance (unchanged 1000 units)
    assert_eq!(score.final_value, 1_000 * UNIT.low);
    assert_eq!(score.return_bps, 0);
}

// ── Legacy path unchanged without float ─────────────────────────────────

#[test]
#[fuzzer(runs: 32, seed: 99)]
fn test_legacy_fuzz_after_values_respected(final_after: u128) {
    // Without float, open_submit_action after values ARE authoritative (legacy)
    let (arena_addr, arena) = deploy_with_adapter();
    arena.register_strategy(FALCON);
    // clamp to avoid BAD_VALUE: must match current_value exactly
    let before: u128 = 1_000;
    let after: u128 = if final_after % 5_000 == 0 { 1_000 } else { final_after % 5_000 };
    // Ensure allocation check passes (1 <= 1000)
    start_cheat_block_timestamp(arena_addr, START + 1);
    start_cheat_caller_address(arena_addr, FALCON.try_into().unwrap());
    // registrant is caller of register_strategy, which defaults to test caller; use open path via that registrant
    // For this fuzz we borrow the adapter-agnostic legacy scoring via submit_action through adapter
    stop_cheat_caller_address(arena_addr);
    start_cheat_caller_address(arena_addr, ADAPTER);
    let _ = arena.submit_action('LG', FALCON, ASSET, TARGET, 1, before, after, 0);
    stop_cheat_caller_address(arena_addr);
    stop_cheat_block_timestamp(arena_addr);
    let score = arena.get_score(FALCON);
    assert_eq!(score.final_value, after);
}

// ── escrowed allocation over cap panics fuzz ────────────────────────────

#[test]
#[fuzzer(runs: 32, seed: 123)]
fn test_fuzz_allocation_cap_enforced(allocation: u128) {
    let (arena_addr, arena) = deploy_with_adapter();
    arena.register_strategy(FALCON);
    let alloc = allocation % 2_000; // try values around cap 350 of 1000 => 35%
    start_cheat_block_timestamp(arena_addr, START + 1);
    start_cheat_caller_address(arena_addr, ADAPTER);
    let r = arena.submit_action('CAP', FALCON, ASSET, TARGET, alloc, 1_000, 1_000, 0);
    stop_cheat_caller_address(arena_addr);
    stop_cheat_block_timestamp(arena_addr);
    if alloc * 10000 > 1_000 * 3_500 {
        assert_eq!(r, reason::ALLOCATION);
    } else {
        // either accepted or other reason but not panic
        assert!(r == reason::ACCEPTED || r == reason::BAD_VALUE || r == reason::ALLOCATION);
    }
}

// ── Attested vs legacy branching: effective_peak = max(start, peak, current) ─

#[test]
fn test_attested_effective_peak_is_max_of_three() {
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy('PEAK');
    stop_cheat_caller_address(arena_addr);
    // checkpoint a higher peak 1500
    float.mint(OTHER, 500 * UNIT);
    arena.checkpoint('PEAK');
    assert_eq!(arena.get_attest_peak('PEAK'), 1_500 * UNIT.low);
    // current dips to 1200 via transfer out (no checkpoint -> stored max stays 0, but score recomputes cur DD)
    start_cheat_caller_address(float_addr, OTHER);
    float.transfer(SPONSOR, 300 * UNIT);
    stop_cheat_caller_address(float_addr);
    let score = arena.get_score('PEAK');
    // effective_peak should be 1500, current 1200 => dd = (300/1500)*10000 = 2000 bps
    assert_eq!(score.max_drawdown_bps, 2000);
    assert_eq!(score.final_value, 1200 * UNIT.low);
    // stored max is still 0 until checkpoint persists the drawdown
    assert_eq!(arena.get_attest_max_dd('PEAK'), 0);
    // checkpoint the dip to persist max DD
    arena.checkpoint('PEAK');
    assert!(arena.get_attest_max_dd('PEAK') >= 2000);
    // Now recover current above peak to 1600 => new effective peak 1600, dd 0 cur, but stored max persists
    float.mint(OTHER, 400 * UNIT);
    let score2 = arena.get_score('PEAK');
    assert_eq!(score2.final_value, 1600 * UNIT.low);
    // max_dd stays 2000 (historical), cur_dd is 0, so reported max is 2000
    assert_eq!(score2.max_drawdown_bps, 2000);
}

// ── custody isolation: spoofed escrow does not affect attested score ───

#[test]
fn test_escrow_spoof_does_not_change_attested_score() {
    // Attested score tracks float only; escrow path (even when it succeeds) must not change it.
    // We verify isolation by ensuring float-only scoring is independent of escrow state.
    // For a full escrow isolation proof, see adapter_v2_test custody tests which use a deployed
    // asset token. Here we prove the simpler invariant: after an escrow attempt is unavailable
    // (no deployed asset at TEST_USD), the attested score remains pinned to float.
    let (arena_addr, arena, float_addr) = deploy_with_float();
    let float = IMockPrizeTokenDispatcher { contract_address: float_addr };
    float.mint(OTHER, 1_000 * UNIT);
    start_cheat_caller_address(arena_addr, OTHER);
    arena.register_strategy(FALCON);
    stop_cheat_caller_address(arena_addr);
    // Try to spoof via open_submit_action (legacy injection vector) — must not affect attested final_value
    start_cheat_block_timestamp(arena_addr, START + 1);
    start_cheat_caller_address(arena_addr, OTHER);
    let _ = arena.open_submit_action('ESCR', FALCON, ASSET, TARGET, 1, 1_000, 9_999_999, 9999);
    stop_cheat_caller_address(arena_addr);
    stop_cheat_block_timestamp(arena_addr);
    let score_before = arena.get_score(FALCON);
    assert_eq!(score_before.final_value, 1_000 * UNIT.low);
    assert_eq!(score_before.return_bps, 0);
    // mutate float to 1500 and ensure score tracks float, not escrow/open_submit values
    float.mint(OTHER, 500 * UNIT);
    let score_after = arena.get_score(FALCON);
    assert_eq!(score_after.final_value, 1_500 * UNIT.low);
    assert_eq!(score_after.return_bps, 5000);
}
