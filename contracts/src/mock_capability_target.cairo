#[starknet::interface]
pub trait IMockCapabilityTarget<TState> {
    fn set_value(ref self: TState, value: u128);
    fn get_value(self: @TState) -> u128;
    fn get_call_count(self: @TState) -> u64;
}

#[starknet::contract]
pub mod MockCapabilityTarget {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockCapabilityTarget;

    #[storage]
    struct Storage {
        gatekeeper: ContractAddress,
        value: u128,
        call_count: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, gatekeeper: ContractAddress) {
        assert(gatekeeper.is_non_zero(), 'ZERO_GATEKEEPER');
        self.gatekeeper.write(gatekeeper);
    }

    #[abi(embed_v0)]
    impl MockCapabilityTargetImpl of IMockCapabilityTarget<ContractState> {
        fn set_value(ref self: ContractState, value: u128) {
            assert(get_caller_address() == self.gatekeeper.read(), 'ONLY_GATEKEEPER');
            self.value.write(value);
            self.call_count.write(self.call_count.read() + 1);
        }

        fn get_value(self: @ContractState) -> u128 { self.value.read() }

        fn get_call_count(self: @ContractState) -> u64 { self.call_count.read() }
    }
}
