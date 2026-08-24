use starknet::ContractAddress;

// Positional Serde must match privacy::objects::OpenNoteDeposit at PRIVACY-0.14.3-RC.2.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IArenaAdapter<TState> {
    fn privacy_invoke(
        ref self: TState,
        token: ContractAddress,
        pool_address: ContractAddress,
        note_id: felt252,
        receipt_id: felt252,
        strategy_commitment: felt252,
        asset: ContractAddress,
        target: ContractAddress,
        allocation_units: u128,
        portfolio_value_before: u128,
        portfolio_value_after: u128,
        drawdown_bps: u16,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod ArenaAdapter {
    use core::num::traits::Zero;
    use crate::arena::{IArenaDispatcher, IArenaDispatcherTrait};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{IArenaAdapter, IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit};

    pub mod errors {
        pub const ONLY_POOL: felt252 = 'ONLY_POOL';
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const TOKEN_ASSET_MISMATCH: felt252 = 'TOKEN_ASSET';
        pub const NO_INPUT: felt252 = 'NO_INPUT';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
        pub const BAD_PRICE: felt252 = 'BAD_PRICE';
        pub const AMOUNT_MISMATCH: felt252 = 'BAD_AMOUNT';
    }

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        arena: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_pool: ContractAddress, arena: ContractAddress) {
        self.privacy_pool.write(privacy_pool);
        self.arena.write(arena);
    }

    #[abi(embed_v0)]
    impl ArenaAdapterImpl of IArenaAdapter<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            token: ContractAddress,
            pool_address: ContractAddress,
            note_id: felt252,
            receipt_id: felt252,
            strategy_commitment: felt252,
            asset: ContractAddress,
            target: ContractAddress,
            allocation_units: u128,
            portfolio_value_before: u128,
            portfolio_value_after: u128,
            drawdown_bps: u16,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            assert(caller == self.privacy_pool.read(), errors::ONLY_POOL);
            assert(pool_address == caller, errors::BAD_POOL);
            assert(token == asset, errors::TOKEN_ASSET_MISMATCH);

            let arena_dispatcher = IArenaDispatcher { contract_address: self.arena.read() };

            // Require the raw tokens delivered to this adapter to equal the
            // submitted allocation converted through the sponsor price
            // (price = raw token units per allocation unit, set pre-start).
            let price = arena_dispatcher.get_price(asset);
            assert(!price.is_zero(), errors::BAD_PRICE);
            let price_u256: u256 = price.into();
            let allocation_u256: u256 = allocation_units.into();
            let expected_amount: u256 = allocation_u256 * price_u256;
            let erc20 = IErc20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(get_contract_address());
            assert(balance == expected_amount, errors::AMOUNT_MISMATCH);

            arena_dispatcher.submit_action(
                receipt_id,
                strategy_commitment,
                asset,
                target,
                allocation_units,
                portfolio_value_before,
                portfolio_value_after,
                drawdown_bps,
            );

            let amount: u128 = balance.try_into().expect(errors::AMOUNT_OVERFLOW);
            assert(amount != 0, errors::NO_INPUT);
            erc20.approve(pool_address, balance);
            array![OpenNoteDeposit { note_id, token, amount }].span()
        }
    }
}
