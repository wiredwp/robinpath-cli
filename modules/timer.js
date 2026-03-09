/**
 * Native timer module for RobinPath.
 * Sleep, delay, and interval utilities.
 */
import { toNum, requireArgs } from './_helpers.js';

const _intervals = new Map();
const _timeouts = new Map();
let _nextId = 1;

export const TimerFunctions = {

    sleep: (args) => {
        const ms = toNum(args[0], 1000);
        return new Promise(resolve => setTimeout(() => resolve(true), ms));
    },

    delay: (args) => {
        const ms = toNum(args[0], 1000);
        return new Promise(resolve => setTimeout(() => resolve(true), ms));
    },

    setTimeout: (args, callback) => {
        requireArgs('timer.setTimeout', args, 1);
        const ms = toNum(args[0], 1000);
        const id = `timeout_${_nextId++}`;
        const handle = setTimeout(() => {
            _timeouts.delete(id);
            if (callback) callback([id]);
        }, ms);
        _timeouts.set(id, handle);
        return id;
    },

    setInterval: (args, callback) => {
        requireArgs('timer.setInterval', args, 1);
        const ms = toNum(args[0], 1000);
        const id = `interval_${_nextId++}`;
        const handle = setInterval(() => {
            if (callback) callback([id]);
        }, ms);
        _intervals.set(id, handle);
        return id;
    },

    clearTimeout: (args) => {
        requireArgs('timer.clearTimeout', args, 1);
        const id = String(args[0]);
        const handle = _timeouts.get(id);
        if (handle) {
            clearTimeout(handle);
            _timeouts.delete(id);
            return true;
        }
        return false;
    },

    clearInterval: (args) => {
        requireArgs('timer.clearInterval', args, 1);
        const id = String(args[0]);
        const handle = _intervals.get(id);
        if (handle) {
            clearInterval(handle);
            _intervals.delete(id);
            return true;
        }
        return false;
    },

    clearAll: () => {
        for (const handle of _timeouts.values()) clearTimeout(handle);
        for (const handle of _intervals.values()) clearInterval(handle);
        _timeouts.clear();
        _intervals.clear();
        return true;
    },

    active: () => {
        return {
            timeouts: Array.from(_timeouts.keys()),
            intervals: Array.from(_intervals.keys())
        };
    },

    measure: async (args, callback) => {
        const start = process.hrtime.bigint();
        if (callback) await callback([]);
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1_000_000;
        return ms;
    },

    timestamp: () => Date.now(),

    now: () => performance.now()
};

export const TimerFunctionMetadata = {
    sleep: {
        description: 'Pause execution for a duration',
        parameters: [{ name: 'milliseconds', dataType: 'number', description: 'Duration in ms (default: 1000)', formInputType: 'number', required: false, defaultValue: 1000 }],
        returnType: 'boolean', returnDescription: 'true when done', example: 'timer.sleep 2000'
    },
    delay: {
        description: 'Alias for sleep',
        parameters: [{ name: 'milliseconds', dataType: 'number', description: 'Duration in ms', formInputType: 'number', required: false, defaultValue: 1000 }],
        returnType: 'boolean', returnDescription: 'true when done', example: 'timer.delay 500'
    },
    setTimeout: {
        description: 'Execute callback after a delay',
        parameters: [{ name: 'milliseconds', dataType: 'number', description: 'Delay in ms', formInputType: 'number', required: true }],
        returnType: 'string', returnDescription: 'Timeout handle ID', example: 'timer.setTimeout 1000'
    },
    setInterval: {
        description: 'Execute callback repeatedly at an interval',
        parameters: [{ name: 'milliseconds', dataType: 'number', description: 'Interval in ms', formInputType: 'number', required: true }],
        returnType: 'string', returnDescription: 'Interval handle ID', example: 'timer.setInterval 5000'
    },
    clearTimeout: {
        description: 'Cancel a pending timeout',
        parameters: [{ name: 'id', dataType: 'string', description: 'Timeout handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if cleared', example: 'timer.clearTimeout $id'
    },
    clearInterval: {
        description: 'Cancel a repeating interval',
        parameters: [{ name: 'id', dataType: 'string', description: 'Interval handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if cleared', example: 'timer.clearInterval $id'
    },
    clearAll: {
        description: 'Cancel all active timeouts and intervals',
        parameters: [],
        returnType: 'boolean', returnDescription: 'true', example: 'timer.clearAll'
    },
    active: {
        description: 'List all active timers',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with timeouts and intervals arrays', example: 'timer.active'
    },
    measure: {
        description: 'Measure execution time of a callback in milliseconds',
        parameters: [],
        returnType: 'number', returnDescription: 'Execution time in ms', example: 'timer.measure'
    },
    timestamp: {
        description: 'Get current Unix timestamp in milliseconds',
        parameters: [],
        returnType: 'number', returnDescription: 'Unix timestamp (ms)', example: 'timer.timestamp'
    },
    now: {
        description: 'Get high-resolution monotonic time (performance.now)',
        parameters: [],
        returnType: 'number', returnDescription: 'Time in ms', example: 'timer.now'
    }
};

export const TimerModuleMetadata = {
    description: 'Timer operations: sleep, delay, setTimeout, setInterval, measure, and timestamp',
    methods: Object.keys(TimerFunctions)
};

export default {
    name: 'timer',
    functions: TimerFunctions,
    functionMetadata: TimerFunctionMetadata,
    moduleMetadata: TimerModuleMetadata,
    global: false
};
