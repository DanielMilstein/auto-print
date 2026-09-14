import { describe, expect, it } from 'vitest';
import { robotJobBlockReason } from './manual-robot';

/** Everything clear: an idle printer, no batch, an idle reachable arm. */
const allowed = {
	kind: 'pick_place' as const,
	gatewayUrl: 'http://robot:8090',
	printerState: 'IDLE' as const,
	batchPhase: null,
	batchRobotJobId: null,
	manualInFlight: false,
	gatewayBusy: false
};

const returning = { ...allowed, kind: 'return_to_origin' as const };

describe('robotJobBlockReason', () => {
	it('allows the trigger when nothing is in the way', () => {
		expect(robotJobBlockReason(allowed)).toBeNull();
	});

	it.each([allowed, returning])('blocks $kind when no gateway is configured', (base) => {
		expect(robotJobBlockReason({ ...base, gatewayUrl: '' })).toMatch(/no robot gateway/i);
	});

	it.each(['PRINTING', 'PAUSED', 'ATTENTION'] as const)('blocks a removal while the printer is %s', (state) => {
		expect(robotJobBlockReason({ ...allowed, printerState: state })).toMatch(/mid-print/i);
	});

	// The base drives across the floor; it never reaches into the bed, so a
	// live print is no reason to refuse it.
	it.each(['PRINTING', 'PAUSED', 'ATTENTION'] as const)(
		'allows a return-to-origin while the printer is %s',
		(state) => {
			expect(robotJobBlockReason({ ...returning, printerState: state })).toBeNull();
		}
	);

	it.each(['IDLE', 'READY', 'FINISHED', 'STOPPED', 'ERROR', 'OFFLINE'] as const)(
		'allows a removal while the printer is %s',
		(state) => {
			expect(robotJobBlockReason({ ...allowed, printerState: state })).toBeNull();
		}
	);

	// An unreadable printer must not block: bench-testing the robot with the
	// printer powered off is a supported case.
	it('allows when the printer state could not be read', () => {
		expect(robotJobBlockReason({ ...allowed, printerState: null })).toBeNull();
	});

	it.each([allowed, returning])(
		'blocks $kind while a batch is running its own removal',
		(base) => {
			const reason = robotJobBlockReason({
				...base,
				batchPhase: 'removing',
				batchRobotJobId: 'job-1'
			});
			expect(reason).toMatch(/batch is already running/i);
		}
	);

	it('allows during other batch phases', () => {
		expect(robotJobBlockReason({ ...allowed, batchPhase: 'idle' })).toBeNull();
	});

	// phase='removing' with the id already cleared means the removal settled.
	it('allows when the batch is removing but holds no robot job id', () => {
		expect(robotJobBlockReason({ ...allowed, batchPhase: 'removing' })).toBeNull();
	});

	it.each([allowed, returning])('blocks $kind behind another manual job', (base) => {
		expect(robotJobBlockReason({ ...base, manualInFlight: true })).toMatch(/already running/i);
	});

	it.each([allowed, returning])('blocks $kind when the gateway reports itself busy', (base) => {
		expect(robotJobBlockReason({ ...base, gatewayBusy: true })).toMatch(/busy/i);
	});

	it('reports the printer before the arm when both would block a removal', () => {
		const reason = robotJobBlockReason({ ...allowed, printerState: 'PRINTING', gatewayBusy: true });
		expect(reason).toMatch(/mid-print/i);
	});
});
