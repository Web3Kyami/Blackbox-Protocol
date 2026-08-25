use starknet::ContractAddress;

#[starknet::interface]
pub trait IPrizeToken<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
}

pub mod reason {
    pub const ACCEPTED: felt252 = 'ACCEPTED';
    pub const NOT_STARTED: felt252 = 'NOT_STARTED';
    pub const CLOSED: felt252 = 'CLOSED';
    pub const UNREGISTERED: felt252 = 'UNREGISTERED';
    pub const DUPLICATE: felt252 = 'DUPLICATE';
    pub const BAD_ASSET: felt252 = 'BAD_ASSET';
    pub const BAD_TARGET: felt252 = 'BAD_TARGET';
    pub const ALLOCATION: felt252 = 'ALLOCATION';
    pub const BAD_VALUE: felt252 = 'BAD_VALUE';
    pub const STALE_PRICE: felt252 = 'STALE_PRICE';
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct StrategyState {
    pub registered: bool,
    pub current_value: u128,
    pub max_drawdown_bps: u16,
    pub registration_order: u32,
    pub accepted_actions: u32,
    pub rejected_actions: u32,
    pub registrant: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct ScoreEntry {
    pub commitment: felt252,
    pub final_value: u128,
    pub return_bps: i64,
    pub max_drawdown_bps: u16,
    pub eligible: bool,
    pub score_bps: i64,
    pub registration_order: u32,
}

#[starknet::interface]
pub trait IArena<TState> {
    fn set_action_adapter(ref self: TState, action_adapter: ContractAddress);
    fn get_action_adapter(self: @TState) -> ContractAddress;
    fn add_allowed_asset(ref self: TState, asset: ContractAddress);
    fn add_allowed_target(ref self: TState, target: ContractAddress);
    fn is_asset_allowed(self: @TState, asset: ContractAddress) -> bool;
    fn is_target_allowed(self: @TState, target: ContractAddress) -> bool;
    fn set_price(ref self: TState, asset: ContractAddress, price: u128);
    fn get_price(self: @TState, asset: ContractAddress) -> u128;
    fn get_price_timestamp(self: @TState, asset: ContractAddress) -> u64;
    fn register_strategy(ref self: TState, commitment: felt252);
    fn get_registrant(self: @TState, commitment: felt252) -> ContractAddress;
    fn submit_action(
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
    fn open_submit_action(
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
    // f1 contract-side: escrowed action — the Arena pulls allocation_units × price
    // from the registrant and verifies its OWN balance delta (contract-observed
    // allocation, no caller trust). Scope note: escrows enforce the bonded
    // ALLOCATION only; portfolio value remains strategy-reported (see
    // docs/VALUE-AXIS-OPTIONS.md for the contract-measured roadmap).
    fn open_submit_action_escrowed(
        ref self: TState,
        receipt_id: felt252,
        strategy_commitment: felt252,
        asset: ContractAddress,
        target: ContractAddress,
        allocation_units: u128,
        drawdown_bps: u16,
    ) -> felt252;
    fn get_escrow(self: @TState, receipt_id: felt252) -> u256;
    fn refund_escrow(ref self: TState, receipt_id: felt252);
    fn close(ref self: TState);
    fn deposit_prize(ref self: TState, amount_units: u128);
    fn get_prize_token(self: @TState) -> ContractAddress;
    fn get_prize_deposited(self: @TState) -> u128;
    fn get_prize_cap(self: @TState) -> u128;
    // f3: permissionless — pays exactly min(prize_deposited, prize_cap_units).
    fn settle(ref self: TState) -> felt252;
    fn get_settlement(self: @TState) -> (felt252, u128);
    fn get_score(self: @TState, commitment: felt252) -> ScoreEntry;
    fn get_action_counts(self: @TState, commitment: felt252) -> (u32, u32);
    fn get_winner(self: @TState) -> felt252;
    fn rules_commitment(self: @TState) -> felt252;
}

#[starknet::contract]
pub mod Arena {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{IArena, IPrizeTokenDispatcher, IPrizeTokenDispatcherTrait, ScoreEntry, StrategyState, reason};

    // P1-critical: caller-supplied portfolio values must NEVER be able to panic
    // scoring. Computed magnitude-first in u256 so no intermediate can overflow.
    const I64_MAG_CAP: u256 = 0x7fffffffffffffff_u256; // 2^63 - 1

    fn clamped_return_bps(final_value: u128, starting_units: u128) -> i64 {
        let negative = final_value < starting_units;
        // Both branches are ordered subtractions — no underflow possible.
        let diff: u256 = if negative {
            (starting_units - final_value).into()
        } else {
            (final_value - starting_units).into()
        };
        // bps magnitude = diff × 10000 / starting (starting >= 1 by constructor);
        // worst case ≈ 2^128 × 10^4 fits u256 comfortably.
        let mag: u256 = (diff * 10000_u256) / starting_units.into();
        let mag = if mag > I64_MAG_CAP { I64_MAG_CAP } else { mag };
        // Safe by construction: mag <= 2^63 - 1, so high limb is zero and the
        // u128 -> i128 -> i64 chain cannot fail (both TryIntos exist in core).
        let mag_i128: i128 = mag.low.try_into().unwrap();
        let magnitude: i64 = mag_i128.try_into().unwrap();
        if negative {
            -magnitude
        } else {
            magnitude
        }
    }

    pub mod errors {
        pub const ONLY_SPONSOR: felt252 = 'ONLY_SPONSOR';
        pub const ONLY_ADAPTER: felt252 = 'ONLY_ADAPTER';
        pub const BAD_TIME: felt252 = 'BAD_TIME';
        pub const BAD_RULES: felt252 = 'BAD_RULES';
        pub const BAD_ADAPTER: felt252 = 'BAD_ADAPTER';
        pub const ADAPTER_ALREADY_SET: felt252 = 'ADAPTER_SET';
        pub const REGISTRATION_CLOSED: felt252 = 'REG_CLOSED';
        pub const DUPLICATE_STRATEGY: felt252 = 'DUP_STRATEGY';
        pub const NOT_CLOSED: felt252 = 'NOT_CLOSED';
        pub const ALREADY_CLOSED: felt252 = 'ALREADY_CLOSED';
        pub const NO_WINNER: felt252 = 'NO_WINNER';
        pub const ALREADY_SETTLED: felt252 = 'ALREADY_SETTLED';
        pub const PRIZE_CAP: felt252 = 'PRIZE_CAP';
        pub const INSUFFICIENT_PRIZE: felt252 = 'NO_PRIZE';
        pub const PRIZE_NO_REGISTRANT: felt252 = 'NO_REGISTRANT';
        pub const PRIZE_TRANSFER_FAILED: felt252 = 'PRIZE_XFER';
        pub const DUPLICATE_ASSET: felt252 = 'DUP_ASSET';
        pub const DUPLICATE_TARGET: felt252 = 'DUP_TARGET';
        pub const BAD_ASSET: felt252 = 'BAD_ASSET';
        pub const UNREGISTERED: felt252 = 'UNREGISTERED';
        pub const ONLY_REGISTRANT: felt252 = 'ONLY_REGISTRANT';
        pub const DUPLICATE: felt252 = 'DUPLICATE';
        pub const BAD_TARGET: felt252 = 'BAD_TARGET';
        pub const STALE_PRICE: felt252 = 'STALE_PRICE';
        pub const BAD_VALUE: felt252 = 'BAD_VALUE';
        pub const ALLOCATION_EXCEEDED: felt252 = 'ALLOC_EXCEED';
        pub const AMOUNT_MISMATCH: felt252 = 'AMT_MISMATCH';
        pub const NO_ESCROW: felt252 = 'NO_ESCROW';
        pub const REGISTRATION_FULL: felt252 = 'REG_FULL';
    }

    #[storage]
    struct Storage {
        sponsor: ContractAddress,
        action_adapter: ContractAddress,
        start_time: u64,
        end_time: u64,
        starting_units: u128,
        max_allocation_bps: u16,
        max_drawdown_bps: u16,
        prize_cap_units: u128,
        allowed_assets: Map<ContractAddress, bool>,
        allowed_targets: Map<ContractAddress, bool>,
        latest_price: Map<ContractAddress, u128>,
        price_timestamp: Map<ContractAddress, u64>,
        asset_count: u32,
        target_count: u32,
        rules_hash: felt252,
        closed: bool,
        settled: bool,
        settlement_winner: felt252,
        settlement_amount: u128,
        prize_token: ContractAddress,
        prize_deposited: u128,
        // P1: hard liveness cap on registration (winner loop is O(n); unbounded
        // registration let a Sybil grief close/settle past Starknet step limits).
        max_strategies: u32,
        registration_count: u32,
        commitments: Map<u32, felt252>,
        strategies: Map<felt252, StrategyState>,
        receipts: Map<felt252, bool>,
        // f1: escrowed allocation per receipt (contract-observed via balance delta)
        escrows: Map<felt252, u256>,
        escrow_registrants: Map<felt252, ContractAddress>,
        escrow_assets: Map<felt252, ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        StrategyRegistered: StrategyRegistered,
        ActionSubmitted: ActionSubmitted,
        ActionEscrowed: ActionEscrowed,
        EscrowRefunded: EscrowRefunded,
        ActionReceipt: ActionReceipt,
        ArenaClosed: ArenaClosed,
        ActionAdapterSet: ActionAdapterSet,
        AssetAdded: AssetAdded,
        TargetAdded: TargetAdded,
        PriceSet: PriceSet,
        PrizeDeposited: PrizeDeposited,
        PrizePaid: PrizePaid,
    }

    #[derive(Drop, starknet::Event)]
    struct StrategyRegistered {
        #[key]
        commitment: felt252,
        registration_order: u32,
        registrant: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct ActionEscrowed {
        #[key]
        receipt_id: felt252,
        #[key]
        strategy_commitment: felt252,
        asset: ContractAddress,
        observed_units: u128,
        accepted: bool,
        escrowed_raw: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct EscrowRefunded {
        #[key]
        receipt_id: felt252,
        recipient: ContractAddress,
        raw_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ActionReceipt {
        #[key]
        receipt_id: felt252,
        #[key]
        strategy_commitment: felt252,
        reason_code: felt252,
        accepted: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct ActionSubmitted {
        #[key]
        receipt_id: felt252,
        #[key]
        strategy_commitment: felt252,
        accepted: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct ArenaClosed {
        winner_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ActionAdapterSet {
        #[key]
        action_adapter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetAdded {
        #[key]
        asset: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct TargetAdded {
        #[key]
        target: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PriceSet {
        #[key]
        asset: ContractAddress,
        price: u128,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PrizeDeposited {
        #[key]
        from: ContractAddress,
        amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct PrizePaid {
        #[key]
        winner_commitment: felt252,
        recipient: ContractAddress,
        amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        sponsor: ContractAddress,
        start_time: u64,
        end_time: u64,
        starting_units: u128,
        max_allocation_bps: u16,
        max_drawdown_bps: u16,
        prize_cap_units: u128,
        prize_token: ContractAddress,
        initial_assets: Span<ContractAddress>,
        initial_targets: Span<ContractAddress>,
        rules_commitment: felt252,
        max_strategies: u32,
    ) {
        assert(start_time < end_time, errors::BAD_TIME);
        assert(starting_units.is_non_zero(), errors::BAD_RULES);
        assert(max_allocation_bps.is_non_zero() && max_allocation_bps <= 10000, errors::BAD_RULES);
        assert(max_drawdown_bps <= 10000, errors::BAD_RULES);
        assert(prize_token.is_non_zero(), errors::BAD_RULES);
        // P1: registration cap must be nonzero (0 would make every round unwinnable).
        assert(max_strategies.is_non_zero(), errors::BAD_RULES);
        self.sponsor.write(sponsor);
        self.action_adapter.write(Zero::zero());
        self.start_time.write(start_time);
        self.end_time.write(end_time);
        self.starting_units.write(starting_units);
        self.max_allocation_bps.write(max_allocation_bps);
        self.max_drawdown_bps.write(max_drawdown_bps);
        self.prize_cap_units.write(prize_cap_units);
        self.prize_token.write(prize_token);
        self.max_strategies.write(max_strategies);
        let mut assets = initial_assets;
        let mut i: usize = 0;
        while i < assets.len() {
            let asset: ContractAddress = *assets[i];
            self.allowed_assets.write(asset, true);
            self.asset_count.write(self.asset_count.read() + 1);
            i += 1;
        };
        let mut targets = initial_targets;
        let mut j: usize = 0;
        while j < targets.len() {
            let target: ContractAddress = *targets[j];
            self.allowed_targets.write(target, true);
            self.target_count.write(self.target_count.read() + 1);
            j += 1;
        };
        self.rules_hash.write(rules_commitment);
    }

    #[abi(embed_v0)]
    impl ArenaImpl of IArena<ContractState> {
        fn set_action_adapter(ref self: ContractState, action_adapter: ContractAddress) {
            assert(get_caller_address() == self.sponsor.read(), errors::ONLY_SPONSOR);
            assert(action_adapter.is_non_zero(), errors::BAD_ADAPTER);
            assert(self.action_adapter.read().is_zero(), errors::ADAPTER_ALREADY_SET);
            assert(get_block_timestamp() < self.start_time.read(), errors::BAD_TIME);
            assert(self.registration_count.read() == 0, errors::REGISTRATION_CLOSED);
            self.action_adapter.write(action_adapter);
            self.emit(ActionAdapterSet { action_adapter });
        }

        fn add_allowed_asset(ref self: ContractState, asset: ContractAddress) {
            assert(get_caller_address() == self.sponsor.read(), errors::ONLY_SPONSOR);
            // P1 (rules freeze): whitelist is immutable once the round starts.
            assert(get_block_timestamp() < self.start_time.read(), errors::BAD_TIME);
            assert(!self.allowed_assets.read(asset), errors::DUPLICATE_ASSET);
            self.allowed_assets.write(asset, true);
            self.asset_count.write(self.asset_count.read() + 1);
            self.emit(AssetAdded { asset });
        }

        fn add_allowed_target(ref self: ContractState, target: ContractAddress) {
            assert(get_caller_address() == self.sponsor.read(), errors::ONLY_SPONSOR);
            // P1 (rules freeze): whitelist is immutable once the round starts.
            assert(get_block_timestamp() < self.start_time.read(), errors::BAD_TIME);
            assert(!self.allowed_targets.read(target), errors::DUPLICATE_TARGET);
            self.allowed_targets.write(target, true);
            self.target_count.write(self.target_count.read() + 1);
            self.emit(TargetAdded { target });
        }

        fn is_asset_allowed(self: @ContractState, asset: ContractAddress) -> bool {
            self.allowed_assets.read(asset)
        }

        fn is_target_allowed(self: @ContractState, target: ContractAddress) -> bool {
            self.allowed_targets.read(target)
        }

        fn set_price(ref self: ContractState, asset: ContractAddress, price: u128) {
            assert(get_caller_address() == self.sponsor.read(), errors::ONLY_SPONSOR);
            assert(self.allowed_assets.read(asset), errors::BAD_ASSET);
            assert(price.is_non_zero(), errors::BAD_RULES);
            assert(get_block_timestamp() < self.start_time.read(), errors::BAD_TIME);
            self.latest_price.write(asset, price);
            self.price_timestamp.write(asset, get_block_timestamp());
            self.emit(PriceSet { asset, price, timestamp: get_block_timestamp() });
        }

        fn get_price(self: @ContractState, asset: ContractAddress) -> u128 {
            self.latest_price.read(asset)
        }

        fn get_price_timestamp(self: @ContractState, asset: ContractAddress) -> u64 {
            self.price_timestamp.read(asset)
        }

        fn get_action_adapter(self: @ContractState) -> ContractAddress {
            self.action_adapter.read()
        }

        fn register_strategy(ref self: ContractState, commitment: felt252) {
            assert(get_block_timestamp() < self.start_time.read(), errors::REGISTRATION_CLOSED);
            let existing = self.strategies.read(commitment);
            assert(!existing.registered, errors::DUPLICATE_STRATEGY);
            // P1: bounded registration — the winner loop is O(n), so an unbounded
            // field let a Sybil grief close()/settle() past Starknet step limits.
            assert(
                self.registration_count.read() < self.max_strategies.read(),
                errors::REGISTRATION_FULL,
            );
            let order = self.registration_count.read() + 1;
            self.registration_count.write(order);
            self.commitments.write(order, commitment);
            let registrant = get_caller_address();
            self.strategies.write(
                commitment,
                StrategyState {
                    registered: true,
                    current_value: self.starting_units.read(),
                    max_drawdown_bps: 0,
                    registration_order: order,
                    accepted_actions: 0,
                    rejected_actions: 0,
                    registrant,
                },
            );
            self.emit(StrategyRegistered { commitment, registration_order: order, registrant });
        }

        fn get_registrant(self: @ContractState, commitment: felt252) -> ContractAddress {
            self.strategies.read(commitment).registrant
        }

        fn submit_action(
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
            let adapter = self.action_adapter.read();
            assert(adapter.is_non_zero() && get_caller_address() == adapter, errors::ONLY_ADAPTER);
            let mut strategy = self.strategies.read(strategy_commitment);
            let now = get_block_timestamp();
            let result = if !strategy.registered {
                reason::UNREGISTERED
            } else if now < self.start_time.read() {
                reason::NOT_STARTED
            } else if now > self.end_time.read() || self.closed.read() {
                reason::CLOSED
            } else if self.receipts.read(receipt_id) {
                reason::DUPLICATE
            } else if !self.allowed_assets.read(asset) {
                reason::BAD_ASSET
            } else if !self.allowed_targets.read(target) {
                reason::BAD_TARGET
            } else if self.price_timestamp.read(asset) == 0 {
                reason::STALE_PRICE
            } else if portfolio_value_before != strategy.current_value || drawdown_bps > 10000 {
                reason::BAD_VALUE
            } else if allocation_units * 10000 > portfolio_value_before * self.max_allocation_bps.read().into() {
                reason::ALLOCATION
            } else {
                reason::ACCEPTED
            };

            if result != reason::DUPLICATE {
                self.receipts.write(receipt_id, true);
            }
            if strategy.registered {
                if result == reason::ACCEPTED {
                    strategy.current_value = portfolio_value_after;
                    if drawdown_bps > strategy.max_drawdown_bps {
                        strategy.max_drawdown_bps = drawdown_bps;
                    }
                    strategy.accepted_actions += 1;
                } else {
                    strategy.rejected_actions += 1;
                }
                self.strategies.write(strategy_commitment, strategy);
            }
            self.emit(ActionReceipt {
                receipt_id,
                strategy_commitment,
                reason_code: result,
                accepted: result == reason::ACCEPTED,
            });
            result
        }

        // f3: permissionless after end_time — closing is an inevitable state
        // transition. P1: liveness is enforced by construction (registration is
        // bounded; scoring converts saturatingly and cannot panic on any stored
        // value). Anyone may finalize the arena.
        fn close(ref self: ContractState) {
            assert(get_block_timestamp() >= self.end_time.read(), errors::BAD_TIME);
            assert(!self.closed.read(), errors::ALREADY_CLOSED);
            self.closed.write(true);
            let winner = self.get_winner();
            self.emit(ArenaClosed { winner_commitment: winner });
        }
        fn open_submit_action(
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
            let caller = get_caller_address();
            let strategy = self.strategies.read(strategy_commitment);
            assert(strategy.registered, errors::UNREGISTERED);
            assert(caller == strategy.registrant, errors::ONLY_REGISTRANT);
            let now = get_block_timestamp();
            assert(now >= self.start_time.read() && now <= self.end_time.read() && !self.closed.read(), errors::BAD_TIME);
            assert(!self.receipts.read(receipt_id), errors::DUPLICATE);
            assert(self.allowed_assets.read(asset), errors::BAD_ASSET);
            assert(self.allowed_targets.read(target), errors::BAD_TARGET);
            assert(self.price_timestamp.read(asset) != 0, errors::STALE_PRICE);
            assert(portfolio_value_before == strategy.current_value, errors::BAD_VALUE);
            assert(allocation_units * 10000 <= portfolio_value_before * self.max_allocation_bps.read().into(), errors::ALLOCATION_EXCEEDED);

            let accepted = allocation_units <= portfolio_value_before;
            let mut new_value = strategy.current_value;
            let mut dd = strategy.max_drawdown_bps;
            if accepted {
                new_value = portfolio_value_after;
                if drawdown_bps > dd { dd = drawdown_bps; };
                self.receipts.write(receipt_id, true);
                let mut s = self.strategies.read(strategy_commitment);
                s.current_value = new_value;
                s.max_drawdown_bps = dd;
                s.accepted_actions += 1;
                self.strategies.write(strategy_commitment, s);
            } else {
                let mut s = self.strategies.read(strategy_commitment);
                s.rejected_actions += 1;
                self.strategies.write(strategy_commitment, s);
            }
            self.emit(ActionSubmitted { receipt_id, strategy_commitment, accepted });
            if accepted { 'ACCEPTED' } else { 'REJECTED' }
        }

        // f1 contract-side: escrowed action. The Arena pulls allocation_units × price
        // from the registrant via transfer_from, then verifies its OWN balance delta —
        // the observed amount is contract-authoritative (no caller-trusted amounts).
        // All validations revert (no soft-reject path); the event marks acceptance.
        fn open_submit_action_escrowed(
            ref self: ContractState,
            receipt_id: felt252,
            strategy_commitment: felt252,
            asset: ContractAddress,
            target: ContractAddress,
            allocation_units: u128,
            drawdown_bps: u16,
        ) -> felt252 {
            let caller = get_caller_address();
            let strategy = self.strategies.read(strategy_commitment);
            assert(strategy.registered, errors::UNREGISTERED);
            assert(caller == strategy.registrant, errors::ONLY_REGISTRANT);
            let now = get_block_timestamp();
            assert(
                now >= self.start_time.read()
                    && now <= self.end_time.read()
                    && !self.closed.read(),
                errors::BAD_TIME,
            );
            assert(!self.receipts.read(receipt_id), errors::DUPLICATE);
            assert(self.allowed_assets.read(asset), errors::BAD_ASSET);
            assert(self.allowed_targets.read(target), errors::BAD_TARGET);
            assert(self.price_timestamp.read(asset) != 0, errors::STALE_PRICE);
            assert(drawdown_bps <= 10000, errors::BAD_VALUE);
            assert(
                allocation_units * 10000
                    <= strategy.current_value * self.max_allocation_bps.read().into(),
                errors::ALLOCATION_EXCEEDED,
            );

            // Pull allocation × price from the registrant and observe the delta ourselves.
            let token = IPrizeTokenDispatcher { contract_address: asset };
            let price = self.latest_price.read(asset);
            assert(price.is_non_zero(), errors::STALE_PRICE);
            let expected: u256 = allocation_units.into() * price.into();
            let balance_before = token.balance_of(get_contract_address());
            let transferred = token.transfer_from(caller, get_contract_address(), expected);
            assert(transferred, errors::PRIZE_TRANSFER_FAILED);
            let observed_delta = token.balance_of(get_contract_address()) - balance_before;
            // Strict: the pull must deliver exactly units × price (fee-on-transfer
            // or rounding skims would short the escrow).
            assert(observed_delta == expected, errors::AMOUNT_MISMATCH);
            // Convert the OBSERVED delta back to allocation-unit terms.
            let observed_units: u128 = (observed_delta / price.into()).try_into().unwrap();
            assert(observed_units == allocation_units, errors::AMOUNT_MISMATCH);

            self.receipts.write(receipt_id, true);
            // Store the RAW amount pulled — refund returns exactly what was
            // escrowed regardless of any later price change on this asset.
            self.escrows.write(receipt_id, observed_delta);
            self.escrow_registrants.write(receipt_id, caller);
            self.escrow_assets.write(receipt_id, asset);
            let mut s = self.strategies.read(strategy_commitment);
            s.accepted_actions += 1;
            if drawdown_bps > s.max_drawdown_bps {
                s.max_drawdown_bps = drawdown_bps;
            }
            self.strategies.write(strategy_commitment, s);

            self.emit(ActionEscrowed {
                receipt_id,
                strategy_commitment,
                asset,
                observed_units,
                accepted: true,
                escrowed_raw: observed_delta,
            });
            'ACCEPTED'
        }

        fn get_escrow(self: @ContractState, receipt_id: felt252) -> u256 {
            self.escrows.read(receipt_id)
        }

        // Permissionless after close: returns the bonded allocation to its registrant.
        fn refund_escrow(ref self: ContractState, receipt_id: felt252) {
            assert(self.closed.read(), errors::NOT_CLOSED);
            let units = self.escrows.read(receipt_id);
            assert(units.is_non_zero(), errors::NO_ESCROW);
            let recipient = self.escrow_registrants.read(receipt_id);
            let asset = self.escrow_assets.read(receipt_id);
            self.escrows.write(receipt_id, 0);
            let token = IPrizeTokenDispatcher { contract_address: asset };
            let transferred = token.transfer(recipient, units.into());
            assert(transferred, errors::PRIZE_TRANSFER_FAILED);
            self.emit(EscrowRefunded { receipt_id, recipient, raw_amount: units });
        }


        fn deposit_prize(ref self: ContractState, amount_units: u128) {
            let caller = get_caller_address();
            assert(caller == self.sponsor.read(), errors::ONLY_SPONSOR);
            assert(amount_units.is_non_zero(), errors::BAD_RULES);
            let token = IPrizeTokenDispatcher { contract_address: self.prize_token.read() };
            let transferred =
                token.transfer_from(caller, get_contract_address(), amount_units.into());
            assert(transferred, errors::PRIZE_TRANSFER_FAILED);
            self.prize_deposited.write(self.prize_deposited.read() + amount_units);
            self.emit(PrizeDeposited { from: caller, amount: amount_units });
        }

        fn get_prize_token(self: @ContractState) -> ContractAddress {
            self.prize_token.read()
        }

        fn get_prize_deposited(self: @ContractState) -> u128 {
            self.prize_deposited.read()
        }

        fn get_prize_cap(self: @ContractState) -> u128 {
            self.prize_cap_units.read()
        }

        fn settle(ref self: ContractState) -> felt252 {
            // f3: permissionless after close — anyone may trigger settlement.
            assert(self.closed.read(), errors::NOT_CLOSED);
            assert(!self.settled.read(), errors::ALREADY_SETTLED);
            let winner = self.get_winner();
            let recipient = self.strategies.read(winner).registrant;
            // Exact structural payout: everything deposited up to the cap. No
            // caller-supplied amount → the sponsor cannot underpay the winner.
            let mut amount_units = self.prize_deposited.read();
            let cap = self.prize_cap_units.read();
            if amount_units > cap {
                amount_units = cap;
            };
            // P1 (CEI): persist ALL settlement state BEFORE the external token
            // transfer. If the token reenters, it observes a settled arena; if
            // the transfer fails, everything reverts atomically anyway.
            self.settled.write(true);
            self.settlement_winner.write(winner);
            self.settlement_amount.write(amount_units);
            assert(recipient.is_non_zero(), errors::PRIZE_NO_REGISTRANT);
            assert(amount_units.is_non_zero(), errors::INSUFFICIENT_PRIZE);
            let token = IPrizeTokenDispatcher { contract_address: self.prize_token.read() };
            let balance = token.balance_of(get_contract_address());
            assert(balance >= amount_units.into(), errors::INSUFFICIENT_PRIZE);
            let transferred = token.transfer(recipient, amount_units.into());
            assert(transferred, errors::PRIZE_TRANSFER_FAILED);
            self.emit(PrizePaid { winner_commitment: winner, recipient, amount: amount_units });
            winner
        }

        fn get_settlement(self: @ContractState) -> (felt252, u128) {
            (self.settlement_winner.read(), self.settlement_amount.read())
        }

        fn get_score(self: @ContractState, commitment: felt252) -> ScoreEntry {
            let strategy = self.strategies.read(commitment);
            // P1-critical: saturating conversion — attacker-controlled values can
            // no longer panic scoring (close() DoS eliminated).
            let return_bps = clamped_return_bps(strategy.current_value, self.starting_units.read());
            let eligible = strategy.registered && strategy.max_drawdown_bps <= self.max_drawdown_bps.read();
            let score_bps = if eligible { return_bps - strategy.max_drawdown_bps.into() } else { 0 };
            ScoreEntry {
                commitment,
                final_value: strategy.current_value,
                return_bps,
                max_drawdown_bps: strategy.max_drawdown_bps,
                eligible,
                score_bps,
                registration_order: strategy.registration_order,
            }
        }

        fn get_action_counts(self: @ContractState, commitment: felt252) -> (u32, u32) {
            let strategy = self.strategies.read(commitment);
            (strategy.accepted_actions, strategy.rejected_actions)
        }

        fn get_winner(self: @ContractState) -> felt252 {
            assert(self.closed.read(), errors::NOT_CLOSED);
            let mut found = false;
            let mut winner: felt252 = 0;
            let mut best = ScoreEntry {
                commitment: 0,
                final_value: 0,
                return_bps: 0,
                max_drawdown_bps: 0,
                eligible: false,
                score_bps: 0,
                registration_order: 0,
            };
            let mut index: u32 = 1;
            while index <= self.registration_count.read() {
                let candidate_commitment = self.commitments.read(index);
                let candidate = self.get_score(candidate_commitment);
                let beats = candidate.eligible && (
                    !found || candidate.score_bps > best.score_bps || (
                        candidate.score_bps == best.score_bps && (
                            candidate.max_drawdown_bps < best.max_drawdown_bps || (
                                candidate.max_drawdown_bps == best.max_drawdown_bps
                                    && candidate.registration_order < best.registration_order
                            )
                        )
                    )
                );
                if beats {
                    found = true;
                    winner = candidate_commitment;
                    best = candidate;
                }
                index += 1;
            };
            assert(found, errors::NO_WINNER);
            winner
        }

        fn rules_commitment(self: @ContractState) -> felt252 {
            self.rules_hash.read()
        }
    }
}
