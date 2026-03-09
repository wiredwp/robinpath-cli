/**
 * Native util module for RobinPath.
 * Utility functions: inspect, format, types, promisify helpers.
 */
import { inspect, format, formatWithOptions, types, TextDecoder, TextEncoder } from 'node:util';
import { toStr, toNum, requireArgs } from './_helpers.js';

export const UtilFunctions = {

    // --- Inspection & Formatting ---

    inspect: (args) => {
        requireArgs('util.inspect', args, 1);
        const obj = args[0];
        const opts = args[1] && typeof args[1] === 'object' ? args[1] : {};
        return inspect(obj, {
            depth: opts.depth != null ? toNum(opts.depth, 4) : 4,
            colors: opts.colors !== false,
            showHidden: opts.showHidden === true,
            maxArrayLength: opts.maxArrayLength != null ? toNum(opts.maxArrayLength) : 100,
            maxStringLength: opts.maxStringLength != null ? toNum(opts.maxStringLength) : 200,
            compact: opts.compact !== false,
            sorted: opts.sorted === true,
            breakLength: opts.breakLength != null ? toNum(opts.breakLength) : 80
        });
    },

    format: (args) => {
        return format(...args.map(a => a));
    },

    formatWithOptions: (args) => {
        requireArgs('util.formatWithOptions', args, 2);
        const opts = args[0];
        return formatWithOptions(opts, ...args.slice(1));
    },

    // --- Type Checks ---

    isArray: (args) => Array.isArray(args[0]),
    isBoolean: (args) => typeof args[0] === 'boolean',
    isNull: (args) => args[0] === null,
    isUndefined: (args) => args[0] === undefined,
    isNullOrUndefined: (args) => args[0] == null,
    isNumber: (args) => typeof args[0] === 'number',
    isString: (args) => typeof args[0] === 'string',
    isObject: (args) => typeof args[0] === 'object' && args[0] !== null,
    isFunction: (args) => typeof args[0] === 'function',
    isRegExp: (args) => args[0] instanceof RegExp,
    isDate: (args) => args[0] instanceof Date,
    isError: (args) => args[0] instanceof Error,
    isPrimitive: (args) => {
        const val = args[0];
        return val === null || (typeof val !== 'object' && typeof val !== 'function');
    },
    isPromise: (args) => types.isPromise(args[0]),
    isMap: (args) => types.isMap(args[0]),
    isSet: (args) => types.isSet(args[0]),
    isTypedArray: (args) => types.isTypedArray(args[0]),
    isArrayBuffer: (args) => types.isArrayBuffer(args[0]),

    typeOf: (args) => {
        requireArgs('util.typeOf', args, 1);
        const val = args[0];
        if (val === null) return 'null';
        if (Array.isArray(val)) return 'array';
        return typeof val;
    },

    // --- Text Encoding ---

    textEncode: (args) => {
        requireArgs('util.textEncode', args, 1);
        const encoder = new TextEncoder();
        const encoded = encoder.encode(toStr(args[0]));
        return Buffer.from(encoded).toString('base64');
    },

    textDecode: (args) => {
        requireArgs('util.textDecode', args, 1);
        const encoding = toStr(args[1], 'utf-8');
        const decoder = new TextDecoder(encoding);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        return decoder.decode(buf);
    },

    // --- Object Utilities ---

    deepClone: (args) => {
        requireArgs('util.deepClone', args, 1);
        return structuredClone(args[0]);
    },

    deepEqual: (args) => {
        requireArgs('util.deepEqual', args, 2);
        try {
            return JSON.stringify(args[0]) === JSON.stringify(args[1]);
        } catch {
            return false;
        }
    },

    merge: (args) => {
        const result = {};
        for (const arg of args) {
            if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
                Object.assign(result, arg);
            }
        }
        return result;
    },

    deepMerge: (args) => {
        function _deepMerge(target, source) {
            const result = { ...target };
            for (const key of Object.keys(source)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
                    target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                    result[key] = _deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        }
        let result = {};
        for (const arg of args) {
            if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
                result = _deepMerge(result, arg);
            }
        }
        return result;
    },

    // --- String Utilities ---

    inherits: () => {
        // Not applicable in RobinPath — return info message
        return 'util.inherits is not needed in RobinPath — use object composition instead';
    },

    deprecate: (args) => {
        requireArgs('util.deprecate', args, 1);
        console.error(`[DEPRECATED] ${toStr(args[0])}`);
        return true;
    },

    // --- Performance ---

    callbackify: () => {
        return 'util.callbackify is not needed — RobinPath handles async natively';
    },

    sizeof: (args) => {
        requireArgs('util.sizeof', args, 1);
        const val = args[0];
        if (val === null || val === undefined) return 0;
        if (typeof val === 'string') return Buffer.byteLength(val, 'utf-8');
        if (typeof val === 'number') return 8;
        if (typeof val === 'boolean') return 4;
        try {
            return Buffer.byteLength(JSON.stringify(val), 'utf-8');
        } catch {
            return 0;
        }
    }
};

export const UtilFunctionMetadata = {
    inspect: {
        description: 'Inspect any value with detailed formatting',
        parameters: [
            { name: 'value', dataType: 'any', description: 'Value to inspect', formInputType: 'json', required: true },
            { name: 'options', dataType: 'object', description: 'Options: depth, colors, showHidden, compact, sorted', formInputType: 'json', required: false }
        ],
        returnType: 'string', returnDescription: 'Formatted inspection string', example: 'util.inspect $obj'
    },
    format: {
        description: 'Format a string with substitutions (%s, %d, %j, %o)',
        parameters: [{ name: 'args', dataType: 'any', description: 'Format string + values', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Formatted string', example: 'util.format "Hello %s, you are %d" "World" 42'
    },
    typeOf: {
        description: 'Get the type of a value (null, array, string, number, object, boolean)',
        parameters: [{ name: 'value', dataType: 'any', description: 'Value to check', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Type string', example: 'util.typeOf [1,2,3]'
    },
    isArray: { description: 'Check if value is an array', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if array', example: 'util.isArray [1,2]' },
    isBoolean: { description: 'Check if value is boolean', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if boolean', example: 'util.isBoolean true' },
    isNull: { description: 'Check if value is null', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if null', example: 'util.isNull $val' },
    isNumber: { description: 'Check if value is a number', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if number', example: 'util.isNumber 42' },
    isString: { description: 'Check if value is a string', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if string', example: 'util.isString "hello"' },
    isObject: { description: 'Check if value is an object (non-null)', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if object', example: 'util.isObject {"a":1}' },
    isPrimitive: { description: 'Check if value is a primitive', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if primitive', example: 'util.isPrimitive 42' },
    textEncode: {
        description: 'Encode string to UTF-8 bytes (base64)',
        parameters: [{ name: 'text', dataType: 'string', description: 'Text to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded bytes', example: 'util.textEncode "hello"'
    },
    textDecode: {
        description: 'Decode bytes (base64) to string',
        parameters: [
            { name: 'data', dataType: 'string', description: 'Base64-encoded data', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'string', returnDescription: 'Decoded string', example: 'util.textDecode $data'
    },
    deepClone: {
        description: 'Deep clone any value',
        parameters: [{ name: 'value', dataType: 'any', description: 'Value to clone', formInputType: 'json', required: true }],
        returnType: 'any', returnDescription: 'Deep cloned value', example: 'util.deepClone $obj'
    },
    deepEqual: {
        description: 'Deep equality comparison',
        parameters: [
            { name: 'a', dataType: 'any', description: 'First value', formInputType: 'json', required: true },
            { name: 'b', dataType: 'any', description: 'Second value', formInputType: 'json', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if deeply equal', example: 'util.deepEqual $a $b'
    },
    merge: {
        description: 'Shallow merge objects',
        parameters: [{ name: 'objects', dataType: 'object', description: 'Objects to merge', formInputType: 'json', required: true }],
        returnType: 'object', returnDescription: 'Merged object', example: 'util.merge $a $b $c'
    },
    deepMerge: {
        description: 'Deep merge objects (recursive)',
        parameters: [{ name: 'objects', dataType: 'object', description: 'Objects to merge', formInputType: 'json', required: true }],
        returnType: 'object', returnDescription: 'Deep merged object', example: 'util.deepMerge $a $b'
    },
    sizeof: {
        description: 'Estimate byte size of a value',
        parameters: [{ name: 'value', dataType: 'any', description: 'Value to measure', formInputType: 'json', required: true }],
        returnType: 'number', returnDescription: 'Approximate byte size', example: 'util.sizeof "hello"'
    },
    formatWithOptions: {
        description: 'Format with inspection options',
        parameters: [
            { name: 'options', dataType: 'object', description: 'Inspection options', formInputType: 'json', required: true },
            { name: 'args', dataType: 'any', description: 'Format string + values', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Formatted string', example: 'util.formatWithOptions {"colors":true} "value: %s" 42'
    },
    isUndefined: { description: 'Check if value is undefined', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if undefined', example: 'util.isUndefined $val' },
    isNullOrUndefined: { description: 'Check if value is null or undefined', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if null or undefined', example: 'util.isNullOrUndefined $val' },
    isFunction: { description: 'Check if value is a function', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if function', example: 'util.isFunction $val' },
    isRegExp: { description: 'Check if value is a RegExp', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if RegExp', example: 'util.isRegExp $val' },
    isDate: { description: 'Check if value is a Date', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if Date', example: 'util.isDate $val' },
    isError: { description: 'Check if value is an Error', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if Error', example: 'util.isError $val' },
    isPromise: { description: 'Check if value is a Promise', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if Promise', example: 'util.isPromise $val' },
    isMap: { description: 'Check if value is a Map', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if Map', example: 'util.isMap $val' },
    isSet: { description: 'Check if value is a Set', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if Set', example: 'util.isSet $val' },
    isTypedArray: { description: 'Check if value is a TypedArray', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if TypedArray', example: 'util.isTypedArray $val' },
    isArrayBuffer: { description: 'Check if value is an ArrayBuffer', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if ArrayBuffer', example: 'util.isArrayBuffer $val' },
    inherits: { description: 'Not needed in RobinPath — use object composition', parameters: [], returnType: 'string', returnDescription: 'Info message', example: 'util.inherits' },
    deprecate: {
        description: 'Log a deprecation warning',
        parameters: [{ name: 'message', dataType: 'string', description: 'Deprecation message', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true', example: 'util.deprecate "Use newFunc instead"'
    },
    callbackify: { description: 'Not needed — RobinPath handles async natively', parameters: [], returnType: 'string', returnDescription: 'Info message', example: 'util.callbackify' }
};

export const UtilModuleMetadata = {
    description: 'Utilities: inspect, format, type checks, deep clone/merge, text encoding, sizeof',
    methods: Object.keys(UtilFunctions)
};

export default {
    name: 'util',
    functions: UtilFunctions,
    functionMetadata: UtilFunctionMetadata,
    moduleMetadata: UtilModuleMetadata,
    global: false
};
