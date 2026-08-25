use starknet::ContractAddress;

// Test-only token that observes settlement state DURING the prize transfer.
// Used to prove the Arena's checks-effects-interactions ordering in settle():
// by the time the external transfer executes, settled must already be true
// (pre-fix it was written only AFTER the transfer returned).
#[starknet::interface]
pub trait IReentrancyObserverToken<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
    fn mint(ref self: TState, account: ContractAddress, amount: u256);
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn observed_settled_during_payout(ref self: TState) -> bool;
}

#[starknet::contract]
pub mod ReentrancyObserverToken {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::ContractAddress;
    use core::num::traits::Zero;
    use blackbox_arena_contracts::arena::{IArenaDispatcher, IArenaDispatcherTrait};
    use super::IReentrancyObserverToken;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        // Records what the Arena looked like mid-transfer during a payout.
        observed_settled_during_payout: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl TokenImpl of IReentrancyObserverToken<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            // Reentry point: read the CALLER's (the Arena's) settled flag now,
            // before any balance movement. This is exactly what a malicious or
            // merely nonstandard token would see.
            let caller = starknet::get_caller_address();
            let arena = IArenaDispatcher { contract_address: caller };
            let (_, settled_amount) = arena.get_settlement();
            if settled_amount.is_non_zero() {
                self.observed_settled_during_payout.write(true);
            }
            let sender = starknet::get_caller_address();
            let from_balance = self.balances.read(sender);
            assert(from_balance >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, from_balance - amount);
            let to_balance = self.balances.read(recipient);
            self.balances.write(recipient, to_balance + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = starknet::get_caller_address();
            let allowance = self.allowances.read((sender, spender));
            assert(allowance >= amount, 'INSUFFICIENT_ALLOWANCE');
            self.allowances.write((sender, spender), allowance - amount);
            let from_balance = self.balances.read(sender);
            assert(from_balance >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, from_balance - amount);
            let to_balance = self.balances.read(recipient);
            self.balances.write(recipient, to_balance + amount);
            true
        }

        fn mint(ref self: ContractState, account: ContractAddress, amount: u256) {
            let balance = self.balances.read(account);
            self.balances.write(account, balance + amount);
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = starknet::get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }

        fn observed_settled_during_payout(ref self: ContractState) -> bool {
            self.observed_settled_during_payout.read()
        }
    }
}
