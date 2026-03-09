/**
 * Shared helpers for RobinPath native modules.
 */
import { resolve } from 'node:path';

/** Coerce value to string with fallback */
export function toStr(val, fallback = '') {
    return val == null ? fallback : String(val);
}

/** Coerce value to number with fallback */
export function toNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isNaN(n) ? fallback : n;
}

/** Coerce value to boolean */
export function toBool(val) {
    if (val === 'false' || val === '0' || val === '') return false;
    return Boolean(val);
}

/** Require minimum number of arguments or throw */
export function requireArgs(funcName, args, min) {
    if (!args || args.length < min) {
        throw new Error(`${funcName} requires at least ${min} argument(s)`);
    }
}

/** Resolve a file path (handles relative + absolute) */
export function toPath(val) {
    return resolve(String(val ?? ''));
}
