/**
 * Re-exports from @wiredwp/robinpath and native modules.
 * All files that need these should import from here instead of using `declare`.
 */
export {
    RobinPath,
    ROBINPATH_VERSION,
    Parser,
    Printer,
    LineIndexImpl,
    formatErrorWithContext,
} from '@wiredwp/robinpath';
export { nativeModules } from '../modules/index.js';
