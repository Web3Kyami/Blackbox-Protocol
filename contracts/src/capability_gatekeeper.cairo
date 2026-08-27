use starknet::ContractAddress;

// Positional Serde must match privacy::objects::OpenNoteDeposit.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait ICapabilityTokenControl<TState> {
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn consume_pool_delivery(ref self: TState, expected_amount: u128);
    fn burn_from_gatekeeper(ref self: TState, amount: u128);
    fn get_issuer(self: @TState) -> ContractAddress;
    fn get_privacy_pool(self: @TState) -> ContractAddress;
    fn get_gatekeeper(self: @TState) -> ContractAddress;
}

#[starknet::interface]
pub trait ICapabilityGatekeeper<TState> {
    fn register_policy(
        ref self: TState,
        capability_token: ContractAddress,
        target: ContractAddress,
        selector: felt252,
        enforce_first_arg_max: bool,
        max_first_arg: u128,
        expires_at: u64,
        reusable: bool,
    );
    fn set_policy_active(
        ref self: TState, capability_token: ContractAddress, active: bool,
    );
    fn privacy_invoke(
        ref self: TState,
        capability_token: ContractAddress,
        target: ContractAddress,
        selector: felt252,
        calldata: Span<felt252>,
        return_note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn get_policy(
        self: @TState, capability_token: ContractAddress,
    ) -> (ContractAddress, ContractAddress, felt252, bool, u128, u64, bool, bool, u64);
    fn get_privacy_pool(self: @TState) -> ContractAddress;
}

#[starknet::contract]
pub mod CapabilityGatekeeper {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address};
    use super::{
        ICapabilityGatekeeper, ICapabilityTokenControlDispatcher,
        ICapabilityTokenControlDispatcherTrait, OpenNoteDeposit,
    };

    const CAPABILITY_UNIT: u128 = 1;

    pub mod errors {
        pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
        pub const ONLY_POOL: felt252 = 'ONLY_POOL';
        pub const ONLY_ISSUER: felt252 = 'ONLY_ISSUER';
        pub const POLICY_EXISTS: felt252 = 'POLICY_EXISTS';
        pub const NO_POLICY: felt252 = 'NO_POLICY';
        pub const POLICY_INACTIVE: felt252 = 'POLICY_INACTIVE';
        pub const POLICY_EXPIRED: felt252 = 'POLICY_EXPIRED';
        pub const BAD_TARGET: felt252 = 'BAD_TARGET';
        pub const BAD_SELECTOR: felt252 = 'BAD_SELECTOR';
        pub const MISSING_FIRST_ARG: felt252 = 'MISSING_ARG';
        pub const FIRST_ARG_OVERFLOW: felt252 = 'ARG_OVERFLOW';
        pub const FIRST_ARG_TOO_HIGH: felt252 = 'ARG_TOO_HIGH';
        pub const BAD_RETURN_NOTE: felt252 = 'BAD_RETURN_NOTE';
        pub const TOKEN_POOL_MISMATCH: felt252 = 'TOKEN_POOL';
        pub const TOKEN_GATEKEEPER_MISMATCH: felt252 = 'TOKEN_GATE';
        pub const REENTRANCY: felt252 = 'REENTRANCY';
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PolicyRegistered: PolicyRegistered,
        PolicyStatusChanged: PolicyStatusChanged,
        CapabilityUsed: CapabilityUsed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PolicyRegistered {
        #[key]
        pub capability_token: ContractAddress,
        #[key]
        pub issuer: ContractAddress,
        pub target: ContractAddress,
        pub selector: felt252,
        pub expires_at: u64,
        pub reusable: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PolicyStatusChanged {
        #[key]
        pub capability_token: ContractAddress,
        pub active: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CapabilityUsed {
        #[key]
        pub capability_token: ContractAddress,
        #[key]
        pub target: ContractAddress,
        pub selector: felt252,
        pub use_number: u64,
        pub reusable: bool,
    }

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        entered: bool,
        issuer: Map<ContractAddress, ContractAddress>,
        target: Map<ContractAddress, ContractAddress>,
        selector: Map<ContractAddress, felt252>,
        enforce_first_arg_max: Map<ContractAddress, bool>,
        max_first_arg: Map<ContractAddress, u128>,
        expires_at: Map<ContractAddress, u64>,
        reusable: Map<ContractAddress, bool>,
        active: Map<ContractAddress, bool>,
        uses: Map<ContractAddress, u64>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_pool: ContractAddress) {
        assert(privacy_pool.is_non_zero(), errors::ZERO_ADDRESS);
        self.privacy_pool.write(privacy_pool);
    }

    #[abi(embed_v0)]
    impl CapabilityGatekeeperImpl of ICapabilityGatekeeper<ContractState> {
        fn register_policy(
            ref self: ContractState,
            capability_token: ContractAddress,
            target: ContractAddress,
            selector: felt252,
            enforce_first_arg_max: bool,
            max_first_arg: u128,
            expires_at: u64,
            reusable: bool,
        ) {
            assert(capability_token.is_non_zero(), errors::ZERO_ADDRESS);
            assert(target.is_non_zero(), errors::ZERO_ADDRESS);
            assert(selector.is_non_zero(), errors::BAD_SELECTOR);
            assert(expires_at > get_block_timestamp(), errors::POLICY_EXPIRED);
            assert(self.issuer.read(capability_token).is_zero(), errors::POLICY_EXISTS);

            let token = ICapabilityTokenControlDispatcher { contract_address: capability_token };
            let issuer = token.get_issuer();
            assert(get_caller_address() == issuer, errors::ONLY_ISSUER);
            assert(token.get_privacy_pool() == self.privacy_pool.read(), errors::TOKEN_POOL_MISMATCH);
            assert(token.get_gatekeeper() == starknet::get_contract_address(), errors::TOKEN_GATEKEEPER_MISMATCH);

            self.issuer.write(capability_token, issuer);
            self.target.write(capability_token, target);
            self.selector.write(capability_token, selector);
            self.enforce_first_arg_max.write(capability_token, enforce_first_arg_max);
            self.max_first_arg.write(capability_token, max_first_arg);
            self.expires_at.write(capability_token, expires_at);
            self.reusable.write(capability_token, reusable);
            self.active.write(capability_token, true);
            self.emit(PolicyRegistered {
                capability_token, issuer, target, selector, expires_at, reusable,
            });
        }

        fn set_policy_active(
            ref self: ContractState, capability_token: ContractAddress, active: bool,
        ) {
            let issuer = self.issuer.read(capability_token);
            assert(issuer.is_non_zero(), errors::NO_POLICY);
            assert(get_caller_address() == issuer, errors::ONLY_ISSUER);
            self.active.write(capability_token, active);
            self.emit(PolicyStatusChanged { capability_token, active });
        }

        fn privacy_invoke(
            ref self: ContractState,
            capability_token: ContractAddress,
            target: ContractAddress,
            selector: felt252,
            calldata: Span<felt252>,
            return_note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.privacy_pool.read(), errors::ONLY_POOL);
            assert(!self.entered.read(), errors::REENTRANCY);
            self.entered.write(true);

            let issuer = self.issuer.read(capability_token);
            assert(issuer.is_non_zero(), errors::NO_POLICY);
            assert(self.active.read(capability_token), errors::POLICY_INACTIVE);
            assert(get_block_timestamp() <= self.expires_at.read(capability_token), errors::POLICY_EXPIRED);
            assert(target == self.target.read(capability_token), errors::BAD_TARGET);
            assert(selector == self.selector.read(capability_token), errors::BAD_SELECTOR);

            if self.enforce_first_arg_max.read(capability_token) {
                assert(!calldata.is_empty(), errors::MISSING_FIRST_ARG);
                let first_arg: u128 = (*calldata[0]).try_into().expect(errors::FIRST_ARG_OVERFLOW);
                assert(first_arg <= self.max_first_arg.read(capability_token), errors::FIRST_ARG_TOO_HIGH);
            }

            let token = ICapabilityTokenControlDispatcher { contract_address: capability_token };
            token.consume_pool_delivery(CAPABILITY_UNIT);

            call_contract_syscall(address: target, entry_point_selector: selector, calldata: calldata)
                .unwrap_syscall();

            let use_number = self.uses.read(capability_token) + 1;
            self.uses.write(capability_token, use_number);
            let reusable = self.reusable.read(capability_token);
            self.emit(CapabilityUsed {
                capability_token, target, selector, use_number, reusable,
            });

            self.entered.write(false);
            if reusable {
                assert(return_note_id.is_non_zero(), errors::BAD_RETURN_NOTE);
                assert(token.approve(self.privacy_pool.read(), CAPABILITY_UNIT.into()), 'APPROVE_FAILED');
                array![OpenNoteDeposit {
                    note_id: return_note_id,
                    token: capability_token,
                    amount: CAPABILITY_UNIT,
                }]
                    .span()
            } else {
                assert(return_note_id.is_zero(), errors::BAD_RETURN_NOTE);
                token.burn_from_gatekeeper(CAPABILITY_UNIT);
                array![].span()
            }
        }

        fn get_policy(
            self: @ContractState, capability_token: ContractAddress,
        ) -> (ContractAddress, ContractAddress, felt252, bool, u128, u64, bool, bool, u64) {
            (
                self.issuer.read(capability_token),
                self.target.read(capability_token),
                self.selector.read(capability_token),
                self.enforce_first_arg_max.read(capability_token),
                self.max_first_arg.read(capability_token),
                self.expires_at.read(capability_token),
                self.reusable.read(capability_token),
                self.active.read(capability_token),
                self.uses.read(capability_token),
            )
        }

        fn get_privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }
    }
}
