use starknet::ContractAddress;

// V2 adapter: per-pool custody accounting.
//
// V1 flaw (codex review): custody was one blind `approve(pool, balance)` — a
// second pool's action overwrote the first pool's withdrawal allowance.
//
// V2 model (matches the Arena's own escrowed-action trust model):
//   - The pool (venue) approves this adapter ONCE per action.
//   - execute_action PULLS allocation_units × price from the pool via
//     transfer_from and verifies the pull succeeded (contract-observed
//     delivery — no caller-trusted amounts).
//   - Delivered capital is recorded per (pool, receipt_id) — pools cannot
//     touch each other's custody.
//   - withdraw() returns ONLY the caller's own receipts, exactly once.
//
// The Arena action is submitted FROM CONTRACT CONTEXT, so the Arena sees the
// mediation (caller == bound adapter) rather than a direct EOA submission.

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait IArenaAdapterV2<TState> {
    fn execute_action(
        ref self: TState,
        receipt_id: felt252,
        strategy_commitment: felt252,
        asset: ContractAddress,
        target: ContractAddress,
        allocation_units: u128,
        portfolio_value_before: u128,
        portfolio_value_after: u128,
        drawdown_bps: u16,
    ) -> felt252;

    fn withdraw(ref self: TState, receipt_id: felt252) -> u256;

    fn get_custody(
        self: @TState, pool: ContractAddress, receipt_id: felt252,
    ) -> (ContractAddress, u256);
}

#[starknet::contract]
pub mod ArenaAdapterV2 {
    use core::num::traits::Zero;
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::arena::{IArenaDispatcher, IArenaDispatcherTrait};
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, IArenaAdapterV2,
    };

    pub mod errors {
        pub const BAD_PRICE: felt252 = 'BAD_PRICE';
        pub const PULL_FAILED: felt252 = 'PULL_FAILED';
        pub const TRANSFER_FAILED: felt252 = 'TRANSFER_FAILED';
        pub const NO_CUSTODY: felt252 = 'NO_CUSTODY';
        pub const ARENA_UNSET: felt252 = 'ARENA_UNSET';
    }

    #[storage]
    struct Storage {
        arena: ContractAddress,
        // custody_amount[(pool, receipt_id)] -> raw asset units held for that pool
        custody_amount: LegacyMap<(ContractAddress, felt252), u256>,
        // custody_asset[(pool, receipt_id)] -> which token that custody is denominated in
        custody_asset: LegacyMap<(ContractAddress, felt252), ContractAddress>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, arena: ContractAddress) {
        assert(!arena.is_zero(), errors::ARENA_UNSET);
        self.arena.write(arena);
    }

    #[abi(embed_v0)]
    impl ArenaAdapterV2Impl of IArenaAdapterV2<ContractState> {
        // Pool funds delivery by approving this adapter; delivery is PULLED and
        // verified here. Custody is recorded regardless of the Arena's verdict —
        // the pool delivered real capital either way. Returns the Arena verdict.
        fn execute_action(
            ref self: ContractState,
            receipt_id: felt252,
            strategy_commitment: felt252,
            asset: ContractAddress,
            target: ContractAddress,
            allocation_units: u128,
            portfolio_value_before: u128,
            portfolio_value_after: u128,
            drawdown_bps: u16,
        ) -> felt252 {
            let pool = get_caller_address();
            let arena_addr = self.arena.read();
            let arena_dispatcher = IArenaDispatcher { contract_address: arena_addr };

            let price = arena_dispatcher.get_price(asset);
            assert(!price.is_zero(), errors::BAD_PRICE);
            let expected_amount: u256 = allocation_units.into() * price.into();

            let erc20 = IErc20Dispatcher { contract_address: asset };
            let pulled = erc20.transfer_from(pool, get_contract_address(), expected_amount);
            assert(pulled, errors::PULL_FAILED);

            let verdict = arena_dispatcher.submit_action(
                receipt_id,
                strategy_commitment,
                asset,
                target,
                allocation_units,
                portfolio_value_before,
                portfolio_value_after,
                drawdown_bps,
            );

            let key = (pool, receipt_id);
            self.custody_asset.write(key, asset);
            let prev = self.custody_amount.read(key);
            self.custody_amount.write(key, prev + expected_amount);
            verdict
        }

        // Permissioned reclaim: only the pool that funded a receipt may pull
        // its own capital back, exactly once. Never affects other pools.
        fn withdraw(ref self: ContractState, receipt_id: felt252) -> u256 {
            let pool = get_caller_address();
            let key = (pool, receipt_id);
            let amount = self.custody_amount.read(key);
            assert(!amount.is_zero(), errors::NO_CUSTODY);
            let asset = self.custody_asset.read(key);
            self.custody_amount.write(key, Zero::zero());
            let erc20 = IErc20Dispatcher { contract_address: asset };
            let sent = erc20.transfer(pool, amount);
            assert(sent, errors::TRANSFER_FAILED);
            amount
        }

        // View: (asset, amount) held for (pool, receipt_id).
        fn get_custody(
            self: @ContractState, pool: ContractAddress, receipt_id: felt252,
        ) -> (ContractAddress, u256) {
            let key = (pool, receipt_id);
            (
                self.custody_asset.read(key),
                self.custody_amount.read(key),
            )
        }
    }
}
