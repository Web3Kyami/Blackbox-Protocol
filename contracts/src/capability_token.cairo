use starknet::ContractAddress;

#[starknet::interface]
pub trait ICapabilityToken<TState> {
    fn name(self: @TState) -> felt252;
    fn symbol(self: @TState) -> felt252;
    fn decimals(self: @TState) -> u8;
    fn total_supply(self: @TState) -> u256;
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: TState, recipient: ContractAddress, amount: u256);
    fn consume_pool_delivery(ref self: TState, expected_amount: u128);
    fn burn_from_gatekeeper(ref self: TState, amount: u128);
    fn get_issuer(self: @TState) -> ContractAddress;
    fn get_privacy_pool(self: @TState) -> ContractAddress;
    fn get_gatekeeper(self: @TState) -> ContractAddress;
    fn get_delivery(self: @TState) -> (felt252, u128, bool);
}

#[starknet::contract]
pub mod CapabilityToken {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_execution_info};
    use super::ICapabilityToken;

    pub mod errors {
        pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
        pub const ONLY_ISSUER: felt252 = 'ONLY_ISSUER';
        pub const ONLY_GATEKEEPER: felt252 = 'ONLY_GATEKEEPER';
        pub const INSUFFICIENT_BALANCE: felt252 = 'LOW_BALANCE';
        pub const INSUFFICIENT_ALLOWANCE: felt252 = 'LOW_ALLOWANCE';
        pub const BAD_DELIVERY_TX: felt252 = 'DELIVERY_TX';
        pub const BAD_DELIVERY_AMOUNT: felt252 = 'DELIVERY_AMOUNT';
        pub const DELIVERY_CONSUMED: felt252 = 'DELIVERY_USED';
        pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
        PoolDeliveryRecorded: PoolDeliveryRecorded,
        PoolDeliveryConsumed: PoolDeliveryConsumed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        #[key]
        pub from: ContractAddress,
        #[key]
        pub to: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Approval {
        #[key]
        pub owner: ContractAddress,
        #[key]
        pub spender: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PoolDeliveryRecorded {
        #[key]
        pub transaction_hash: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PoolDeliveryConsumed {
        #[key]
        pub transaction_hash: felt252,
        pub amount: u128,
    }

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        issuer: ContractAddress,
        privacy_pool: ContractAddress,
        gatekeeper: ContractAddress,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        delivery_tx_hash: felt252,
        delivery_amount: u128,
        delivery_consumed: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: felt252,
        symbol: felt252,
        issuer: ContractAddress,
        privacy_pool: ContractAddress,
        gatekeeper: ContractAddress,
    ) {
        assert(issuer.is_non_zero(), errors::ZERO_ADDRESS);
        assert(privacy_pool.is_non_zero(), errors::ZERO_ADDRESS);
        assert(gatekeeper.is_non_zero(), errors::ZERO_ADDRESS);
        self.name.write(name);
        self.symbol.write(symbol);
        self.issuer.write(issuer);
        self.privacy_pool.write(privacy_pool);
        self.gatekeeper.write(gatekeeper);
    }

    #[abi(embed_v0)]
    impl CapabilityTokenImpl of ICapabilityToken<ContractState> {
        fn name(self: @ContractState) -> felt252 { self.name.read() }

        fn symbol(self: @ContractState) -> felt252 { self.symbol.read() }

        fn decimals(self: @ContractState) -> u8 { 0 }

        fn total_supply(self: @ContractState) -> u256 { self.total_supply.read() }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(
            ref self: ContractState, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            if spender != sender {
                let allowed = self.allowances.read((sender, spender));
                assert(allowed >= amount, errors::INSUFFICIENT_ALLOWANCE);
                self.allowances.write((sender, spender), allowed - amount);
            }
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(
            ref self: ContractState, spender: ContractAddress, amount: u256,
        ) -> bool {
            assert(spender.is_non_zero(), errors::ZERO_ADDRESS);
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, amount });
            true
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            assert(get_caller_address() == self.issuer.read(), errors::ONLY_ISSUER);
            assert(recipient.is_non_zero(), errors::ZERO_ADDRESS);
            let balance = self.balances.read(recipient);
            self.balances.write(recipient, balance + amount);
            self.total_supply.write(self.total_supply.read() + amount);
            self.emit(Transfer { from: Zero::zero(), to: recipient, amount });
        }

        fn consume_pool_delivery(ref self: ContractState, expected_amount: u128) {
            assert(get_caller_address() == self.gatekeeper.read(), errors::ONLY_GATEKEEPER);
            let current_tx = get_execution_info().tx_info.transaction_hash;
            assert(self.delivery_tx_hash.read() == current_tx, errors::BAD_DELIVERY_TX);
            assert(!self.delivery_consumed.read(), errors::DELIVERY_CONSUMED);
            assert(self.delivery_amount.read() == expected_amount, errors::BAD_DELIVERY_AMOUNT);
            self.delivery_consumed.write(true);
            self.emit(PoolDeliveryConsumed { transaction_hash: current_tx, amount: expected_amount });
        }

        fn burn_from_gatekeeper(ref self: ContractState, amount: u128) {
            let gatekeeper = self.gatekeeper.read();
            assert(get_caller_address() == gatekeeper, errors::ONLY_GATEKEEPER);
            let amount_u256: u256 = amount.into();
            let balance = self.balances.read(gatekeeper);
            assert(balance >= amount_u256, errors::INSUFFICIENT_BALANCE);
            self.balances.write(gatekeeper, balance - amount_u256);
            self.total_supply.write(self.total_supply.read() - amount_u256);
            self.emit(Transfer { from: gatekeeper, to: Zero::zero(), amount: amount_u256 });
        }

        fn get_issuer(self: @ContractState) -> ContractAddress { self.issuer.read() }

        fn get_privacy_pool(self: @ContractState) -> ContractAddress { self.privacy_pool.read() }

        fn get_gatekeeper(self: @ContractState) -> ContractAddress { self.gatekeeper.read() }

        fn get_delivery(self: @ContractState) -> (felt252, u128, bool) {
            (
                self.delivery_tx_hash.read(),
                self.delivery_amount.read(),
                self.delivery_consumed.read(),
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            assert(recipient.is_non_zero(), errors::ZERO_ADDRESS);
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, errors::INSUFFICIENT_BALANCE);
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);

            if sender == self.privacy_pool.read() && recipient == self.gatekeeper.read() {
                let amount_u128: u128 = amount.try_into().expect(errors::AMOUNT_OVERFLOW);
                let transaction_hash = get_execution_info().tx_info.transaction_hash;
                self.delivery_tx_hash.write(transaction_hash);
                self.delivery_amount.write(amount_u128);
                self.delivery_consumed.write(false);
                self.emit(PoolDeliveryRecorded { transaction_hash, amount: amount_u128 });
            }

            self.emit(Transfer { from: sender, to: recipient, amount });
        }
    }
}
