use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockPrizeToken<TState> {
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
}

#[starknet::contract]
pub mod MockPrizeToken {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use starknet::ContractAddress;
    use super::IMockPrizeToken;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl TokenImpl of IMockPrizeToken<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
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
    }
}
