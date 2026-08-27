use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20TransferFrom<TState> {
    fn transfer_from(
        ref self: TState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait ITreasurySpendAdapter<TState> {
    fn spend(ref self: TState, amount: u128);
    fn get_config(
        self: @TState,
    ) -> (ContractAddress, ContractAddress, ContractAddress, ContractAddress);
    fn get_total_spent(self: @TState) -> u256;
}

/// A deliberately narrow target for BlackBox treasury capabilities.
///
/// The treasury, ERC-20 asset, and recipient are immutable. A capability holder
/// controls only `amount`; the Gatekeeper policy can therefore enforce its
/// first-argument maximum without leaving token or destination selection open.
/// The treasury must approve this adapter before a capability can be exercised.
#[starknet::contract]
pub mod TreasurySpendAdapter {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::{IERC20TransferFromDispatcher, IERC20TransferFromDispatcherTrait, ITreasurySpendAdapter};

    pub mod errors {
        pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
        pub const ONLY_GATEKEEPER: felt252 = 'ONLY_GATEKEEPER';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
        pub const TRANSFER_FAILED: felt252 = 'TRANSFER_FAILED';
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TreasurySpent: TreasurySpent,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TreasurySpent {
        #[key]
        pub treasury: ContractAddress,
        #[key]
        pub token: ContractAddress,
        #[key]
        pub recipient: ContractAddress,
        pub amount: u128,
        pub total_spent: u256,
    }

    #[storage]
    struct Storage {
        gatekeeper: ContractAddress,
        treasury: ContractAddress,
        token: ContractAddress,
        recipient: ContractAddress,
        total_spent: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        gatekeeper: ContractAddress,
        treasury: ContractAddress,
        token: ContractAddress,
        recipient: ContractAddress,
    ) {
        assert(gatekeeper.is_non_zero(), errors::ZERO_ADDRESS);
        assert(treasury.is_non_zero(), errors::ZERO_ADDRESS);
        assert(token.is_non_zero(), errors::ZERO_ADDRESS);
        assert(recipient.is_non_zero(), errors::ZERO_ADDRESS);
        self.gatekeeper.write(gatekeeper);
        self.treasury.write(treasury);
        self.token.write(token);
        self.recipient.write(recipient);
    }

    #[abi(embed_v0)]
    impl TreasurySpendAdapterImpl of ITreasurySpendAdapter<ContractState> {
        fn spend(ref self: ContractState, amount: u128) {
            assert(get_caller_address() == self.gatekeeper.read(), errors::ONLY_GATEKEEPER);
            assert(amount > 0, errors::ZERO_AMOUNT);

            let token = IERC20TransferFromDispatcher { contract_address: self.token.read() };
            assert(
                token.transfer_from(self.treasury.read(), self.recipient.read(), amount.into()),
                errors::TRANSFER_FAILED,
            );

            let total_spent = self.total_spent.read() + amount.into();
            self.total_spent.write(total_spent);
            self.emit(TreasurySpent {
                treasury: self.treasury.read(),
                token: self.token.read(),
                recipient: self.recipient.read(),
                amount,
                total_spent,
            });
        }

        fn get_config(
            self: @ContractState,
        ) -> (ContractAddress, ContractAddress, ContractAddress, ContractAddress) {
            (
                self.gatekeeper.read(),
                self.treasury.read(),
                self.token.read(),
                self.recipient.read(),
            )
        }

        fn get_total_spent(self: @ContractState) -> u256 { self.total_spent.read() }
    }
}
