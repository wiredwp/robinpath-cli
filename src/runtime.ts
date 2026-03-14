/**
 * Lazy-loading runtime dependencies.
 *
 * Heavy deps (@wiredwp/robinpath ~23ms, native modules ~60ms) are loaded
 * on first access, not at import time. Commands that don't need the language
 * runtime (--version, --help, ai, config) start ~80ms faster.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let _rp: any = null;
let _modules: any[] | null = null;

function rp(): any {
    if (!_rp) _rp = require('@wiredwp/robinpath');
    return _rp;
}

export function getRobinPathClass(): any { return rp().RobinPath; }
export function getROBINPATH_VERSION(): string { return rp().ROBINPATH_VERSION; }
export function getParser(): any { return rp().Parser; }
export function getPrinter(): any { return rp().Printer; }
export function getLineIndexImpl(): any { return rp().LineIndexImpl; }
export function getFormatErrorWithContext(): (...args: any[]) => any { return rp().formatErrorWithContext; }
export function getNativeModules(): any[] {
    if (!_modules) _modules = require('../modules/index.js').nativeModules;
    return _modules!;
}
