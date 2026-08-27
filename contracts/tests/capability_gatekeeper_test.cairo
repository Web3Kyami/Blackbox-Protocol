use blackbox_arena_contracts::capability_gatekeeper::{
    ICapabilityGatekeeperDispatcher, ICapabilityGatekeeperDispatcherTrait, OpenNoteDeposit,
};
use blackbox_arena_contracts::capability_token::{
    ICapabilityTokenDispatcher, ICapabilityTokenDispatcherTrait,
};
use blackbox_arena_contracts::mock_capability_target::{
    IMockCapabilityTargetDispatcher, IMockCapabilityTargetDispatcherTrait,
};
use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, start_cheat_transaction_hash_global,
    stop_cheat_block_timestamp_global, stop_cheat_caller_address,
    stop_cheat_transaction_hash_global,
};
use starknet::{ContractAddress, SyscallResultTrait};

const ISSUER: ContractAddress = 'ISSUER'.try_into().unwrap();
const POOL: ContractAddress = 'PRIVACY_POOL'.try_into().unwrap();
const OTHER: ContractAddress = 'OTHER'.try_into().unwrap();
const SET_VALUE_SELECTOR: felt252 = selector!("set_value");
const OTHER_SELECTOR: felt252 = selector!("get_value");
const EXPIRY: u64 = 1_000;
const TX_1: felt252 = 'TX_ONE';
const TX_2: felt252 = 'TX_TWO';

fn setup(
    reusable: bool, enforce_max: bool, max_first_arg: u128,
) -> (
    ICapabilityGatekeeperDispatcher,
    ICapabilityTokenDispatcher,
    IMockCapabilityTargetDispatcher,
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

    let (target_address, _) = declare("MockCapabilityTarget")
        .unwrap_syscall()
        .contract_class()
        .deploy(@array![gatekeeper_address.into()])
        .unwrap_syscall();

    let (token_address, _) = declare("CapabilityToken")
        .unwrap_syscall()
        .contract_class()
        .deploy(
            @array![
                'Treasury Operator',
                'BB_OP',
                ISSUER.into(),
                POOL.into(),
                gatekeeper_address.into(),
            ],
        )
        .unwrap_syscall();

    let gatekeeper = ICapabilityGatekeeperDispatcher { contract_address: gatekeeper_address };
    let token = ICapabilityTokenDispatcher { contract_address: token_address };
    let target = IMockCapabilityTargetDispatcher { contract_address: target_address };

    start_cheat_caller_address(gatekeeper_address, ISSUER);
    gatekeeper.register_policy(
        token_address,
        target_address,
        SET_VALUE_SELECTOR,
        enforce_max,
        max_first_arg,
        EXPIRY,
        reusable,
    );
    stop_cheat_caller_address(gatekeeper_address);

    start_cheat_caller_address(token_address, ISSUER);
    token.mint(POOL, 10);
    stop_cheat_caller_address(token_address);

    (gatekeeper, token, target, gatekeeper_address, token_address, target_address)
}

fn deliver_in_current_tx(
    token: ICapabilityTokenDispatcher,
    token_address: ContractAddress,
    gatekeeper_address: ContractAddress,
    transaction_hash: felt252,
    amount: u128,
) {
    start_cheat_transaction_hash_global(transaction_hash);
    start_cheat_caller_address(token_address, POOL);
    token.transfer(gatekeeper_address, amount.into());
    stop_cheat_caller_address(token_address);
}

fn invoke_set_value(
    gatekeeper: ICapabilityGatekeeperDispatcher,
    gatekeeper_address: ContractAddress,
    token_address: ContractAddress,
    target_address: ContractAddress,
    value: u128,
    return_note_id: felt252,
) -> Span<OpenNoteDeposit> {
    start_cheat_caller_address(gatekeeper_address, POOL);
    let deposits = gatekeeper.privacy_invoke(
        token_address,
        target_address,
        SET_VALUE_SELECTOR,
        array![value.into()].span(),
        return_note_id,
    );
    stop_cheat_caller_address(gatekeeper_address);
    deposits
}

fn finish_cheats() {
    stop_cheat_transaction_hash_global();
    stop_cheat_block_timestamp_global();
}

#[test]
fn test_reusable_capability_executes_and_returns_open_note() {
    let (gatekeeper, token, target, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);

    let deposits = invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 75, 'RETURN_NOTE',
    );

    assert_eq!(target.get_value(), 75);
    assert_eq!(target.get_call_count(), 1);
    assert_eq!(deposits.len(), 1);
    let OpenNoteDeposit { note_id, token: returned_token, amount } = *deposits[0];
    assert_eq!(note_id, 'RETURN_NOTE');
    assert_eq!(returned_token, token_address);
    assert_eq!(amount, 1);
    assert_eq!(token.allowance(gatekeeper_address, POOL), 1);
    let (_, _, _, _, _, _, _, _, uses) = gatekeeper.get_policy(token_address);
    assert_eq!(uses, 1);

    // Mirrors the pool's post-invoke open-note deposit pull.
    start_cheat_caller_address(token_address, POOL);
    token.transfer_from(gatekeeper_address, POOL, 1);
    stop_cheat_caller_address(token_address);
    assert_eq!(token.balance_of(gatekeeper_address), Zero::zero());
    finish_cheats();
}

#[test]
fn test_one_shot_capability_executes_and_burns() {
    let (gatekeeper, token, target, gatekeeper_address, token_address, target_address) =
        setup(false, true, 100);
    let supply_before = token.total_supply();
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);

    let deposits = invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 42, 0,
    );

    assert!(deposits.is_empty());
    assert_eq!(target.get_value(), 42);
    assert_eq!(token.balance_of(gatekeeper_address), Zero::zero());
    assert_eq!(token.total_supply(), supply_before - 1);
    finish_cheats();
}

#[test]
#[should_panic(expected: 'DELIVERY_TX')]
fn test_preloaded_capability_cannot_authorize_later_transaction() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    stop_cheat_transaction_hash_global();
    start_cheat_transaction_hash_global(TX_2);

    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 50, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'DELIVERY_AMOUNT')]
fn test_wrong_capability_amount_rejected() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 2);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 50, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'DELIVERY_USED')]
fn test_same_delivery_cannot_be_replayed() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 10, 'RETURN_ONE',
    );
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 11, 'RETURN_TWO',
    );
}

#[test]
#[should_panic(expected: 'ARG_TOO_HIGH')]
fn test_first_argument_limit_enforced() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 101, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'BAD_TARGET')]
fn test_wrong_target_rejected() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, _) = setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(gatekeeper, gatekeeper_address, token_address, OTHER, 50, 'RETURN_NOTE');
}

#[test]
#[should_panic(expected: 'BAD_SELECTOR')]
fn test_wrong_selector_rejected() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    start_cheat_caller_address(gatekeeper_address, POOL);
    gatekeeper.privacy_invoke(
        token_address,
        target_address,
        OTHER_SELECTOR,
        array![50].span(),
        'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'POLICY_INACTIVE')]
fn test_issuer_can_revoke_entire_capability_class() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    start_cheat_caller_address(gatekeeper_address, ISSUER);
    gatekeeper.set_policy_active(token_address, false);
    stop_cheat_caller_address(gatekeeper_address);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 50, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'POLICY_EXPIRED')]
fn test_expired_capability_rejected() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    stop_cheat_block_timestamp_global();
    start_cheat_block_timestamp_global(EXPIRY + 1);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 50, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn test_direct_gatekeeper_call_rejected() {
    let (gatekeeper, _, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    start_cheat_caller_address(gatekeeper_address, OTHER);
    gatekeeper.privacy_invoke(
        token_address,
        target_address,
        SET_VALUE_SELECTOR,
        array![50].span(),
        'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'ONLY_GATEKEEPER')]
fn test_non_gatekeeper_cannot_consume_delivery() {
    let (_, token, _, _, _, _) = setup(true, true, 100);
    start_cheat_caller_address(token.contract_address, OTHER);
    token.consume_pool_delivery(1);
}

#[test]
#[should_panic(expected: 'MISSING_ARG')]
fn test_enabled_first_argument_limit_requires_calldata() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    start_cheat_caller_address(gatekeeper_address, POOL);
    gatekeeper.privacy_invoke(
        token_address, target_address, SET_VALUE_SELECTOR, array![].span(), 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'BAD_RETURN_NOTE')]
fn test_reusable_capability_requires_return_note() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(true, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(gatekeeper, gatekeeper_address, token_address, target_address, 50, 0);
}

#[test]
#[should_panic(expected: 'BAD_RETURN_NOTE')]
fn test_one_shot_capability_forbids_return_note() {
    let (gatekeeper, token, _, gatekeeper_address, token_address, target_address) =
        setup(false, true, 100);
    deliver_in_current_tx(token, token_address, gatekeeper_address, TX_1, 1);
    invoke_set_value(
        gatekeeper, gatekeeper_address, token_address, target_address, 50, 'RETURN_NOTE',
    );
}

#[test]
#[should_panic(expected: 'ONLY_ISSUER')]
fn test_non_issuer_cannot_change_policy_status() {
    let (gatekeeper, _, _, gatekeeper_address, token_address, _) = setup(true, true, 100);
    start_cheat_caller_address(gatekeeper_address, OTHER);
    gatekeeper.set_policy_active(token_address, false);
}
