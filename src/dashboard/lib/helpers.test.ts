import { describe, it, expect } from 'vitest';
import { condenseRecentActions, RecentAction } from './helpers.js';

describe('condenseRecentActions', () => {
	it('returns an empty array when given an empty array', () => {
		expect(condenseRecentActions([], 10)).toEqual([]);
	});

	it('returns a single condensed item with burstCount 1 for a single action', () => {
		const action: RecentAction = {
			id: 1,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		expect(condenseRecentActions([action], 10)).toEqual([
			{ ...action, burstCount: 1 },
		]);
	});

	it('condenses identical items within 10 minutes', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			query: 'test',
			memory_id: 'mem1',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.store',
			query: 'test',
			memory_id: 'mem1',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2], 10)).toEqual([
			{ ...action1, id: 1, created_at: action2.created_at, burstCount: 2 },
		]);
	});

	it('does not condense identical items separated by more than 10 minutes', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			query: 'test',
			memory_id: 'mem1',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.store',
			query: 'test',
			memory_id: 'mem1',
			created_at: new Date('2024-01-01T10:15:00Z').toISOString(), // 15 mins later
		};
		expect(condenseRecentActions([action1, action2], 10)).toEqual([
			{ ...action1, burstCount: 1 },
			{ ...action2, burstCount: 1 },
		]);
	});

	it('does not condense items with different actions', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.search',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2], 10)).toEqual([
			{ ...action1, burstCount: 1 },
			{ ...action2, burstCount: 1 },
		]);
	});

	it('does not condense items with different queries', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			query: 'test1',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.store',
			query: 'test2',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2], 10)).toEqual([
			{ ...action1, burstCount: 1 },
			{ ...action2, burstCount: 1 },
		]);
	});

	it('does not condense items with different memory_ids', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			memory_id: 'mem1',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.store',
			memory_id: 'mem2',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2], 10)).toEqual([
			{ ...action1, burstCount: 1 },
			{ ...action2, burstCount: 1 },
		]);
	});

	it('condenses multiple items consecutively', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		const action3: RecentAction = {
			id: 3,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:08:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2, action3], 10)).toEqual([
			{ ...action1, created_at: action3.created_at, burstCount: 3 },
		]);
	});

	it('handles a series of actions with an interrupting different action', () => {
		const action1: RecentAction = {
			id: 1,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
		};
		const action2: RecentAction = {
			id: 2,
			action: 'memory.search',
			created_at: new Date('2024-01-01T10:05:00Z').toISOString(),
		};
		const action3: RecentAction = {
			id: 3,
			action: 'memory.store',
			created_at: new Date('2024-01-01T10:08:00Z').toISOString(),
		};
		expect(condenseRecentActions([action1, action2, action3], 10)).toEqual([
			{ ...action1, burstCount: 1 },
			{ ...action2, burstCount: 1 },
			{ ...action3, burstCount: 1 },
		]);
	});

	it('respects the limit parameter', () => {
		const actions: RecentAction[] = Array.from({ length: 5 }, (_, i) => ({
			id: i + 1,
			action: `action_${i}`,
			created_at: new Date(`2024-01-01T10:0${i}:00Z`).toISOString(),
		}));

		expect(condenseRecentActions(actions, 3)).toEqual([
			{ ...actions[0], burstCount: 1 },
			{ ...actions[1], burstCount: 1 },
			{ ...actions[2], burstCount: 1 },
		]);
	});
});
