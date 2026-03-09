/**
 * Native buffer module for RobinPath.
 * Buffer operations for binary data handling.
 */
import { toStr, toNum, requireArgs } from './_helpers.js';

export const BufferFunctions = {

    alloc: (args) => {
        const size = toNum(args[0], 0);
        const fill = args[1] != null ? toNum(args[1], 0) : 0;
        return Buffer.alloc(size, fill).toString('base64');
    },

    from: (args) => {
        requireArgs('buffer.from', args, 1);
        const data = args[0];
        const encoding = toStr(args[1], 'utf-8');
        if (typeof data === 'string') {
            return Buffer.from(data, encoding).toString('base64');
        }
        if (Array.isArray(data)) {
            return Buffer.from(data).toString('base64');
        }
        return Buffer.from(String(data)).toString('base64');
    },

    toString: (args) => {
        requireArgs('buffer.toString', args, 1);
        const base64 = toStr(args[0]);
        const encoding = toStr(args[1], 'utf-8');
        return Buffer.from(base64, 'base64').toString(encoding);
    },

    toJSON: (args) => {
        requireArgs('buffer.toJSON', args, 1);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        return { type: 'Buffer', data: Array.from(buf) };
    },

    concat: (args) => {
        if (!Array.isArray(args[0])) throw new Error('buffer.concat requires an array of base64 buffers');
        const buffers = args[0].map(b => Buffer.from(toStr(b), 'base64'));
        return Buffer.concat(buffers).toString('base64');
    },

    compare: (args) => {
        requireArgs('buffer.compare', args, 2);
        const a = Buffer.from(toStr(args[0]), 'base64');
        const b = Buffer.from(toStr(args[1]), 'base64');
        return Buffer.compare(a, b);
    },

    equals: (args) => {
        requireArgs('buffer.equals', args, 2);
        const a = Buffer.from(toStr(args[0]), 'base64');
        const b = Buffer.from(toStr(args[1]), 'base64');
        return a.equals(b);
    },

    slice: (args) => {
        requireArgs('buffer.slice', args, 1);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        const start = toNum(args[1], 0);
        const end = args[2] != null ? toNum(args[2]) : buf.length;
        return buf.subarray(start, end).toString('base64');
    },

    length: (args) => {
        requireArgs('buffer.length', args, 1);
        return Buffer.from(toStr(args[0]), 'base64').length;
    },

    byteLength: (args) => {
        requireArgs('buffer.byteLength', args, 1);
        const data = toStr(args[0]);
        const encoding = toStr(args[1], 'utf-8');
        return Buffer.byteLength(data, encoding);
    },

    isBuffer: (args) => {
        requireArgs('buffer.isBuffer', args, 1);
        // In RobinPath, buffers are base64 strings — check if valid base64
        try {
            const str = toStr(args[0]);
            const buf = Buffer.from(str, 'base64');
            return buf.toString('base64') === str;
        } catch { return false; }
    },

    fill: (args) => {
        requireArgs('buffer.fill', args, 2);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        const value = toNum(args[1], 0);
        buf.fill(value);
        return buf.toString('base64');
    },

    indexOf: (args) => {
        requireArgs('buffer.indexOf', args, 2);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        const search = toStr(args[1]);
        return buf.indexOf(search);
    },

    copy: (args) => {
        requireArgs('buffer.copy', args, 1);
        const buf = Buffer.from(toStr(args[0]), 'base64');
        return Buffer.from(buf).toString('base64');
    },

    toHex: (args) => {
        requireArgs('buffer.toHex', args, 1);
        return Buffer.from(toStr(args[0]), 'base64').toString('hex');
    },

    fromHex: (args) => {
        requireArgs('buffer.fromHex', args, 1);
        return Buffer.from(toStr(args[0]), 'hex').toString('base64');
    }
};

export const BufferFunctionMetadata = {
    alloc: {
        description: 'Allocate a buffer of given size',
        parameters: [
            { name: 'size', dataType: 'number', description: 'Size in bytes', formInputType: 'number', required: true },
            { name: 'fill', dataType: 'number', description: 'Fill value (default: 0)', formInputType: 'number', required: false, defaultValue: 0 }
        ],
        returnType: 'string', returnDescription: 'Base64-encoded buffer', example: 'buffer.alloc 16'
    },
    from: {
        description: 'Create a buffer from string or array',
        parameters: [
            { name: 'data', dataType: 'any', description: 'Input data', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Input encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'string', returnDescription: 'Base64-encoded buffer', example: 'buffer.from "hello"'
    },
    toString: {
        description: 'Convert buffer to string',
        parameters: [
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Output encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'string', returnDescription: 'Decoded string', example: 'buffer.toString $buf'
    },
    toJSON: {
        description: 'Convert buffer to JSON representation',
        parameters: [{ name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: '{type, data} object', example: 'buffer.toJSON $buf'
    },
    concat: {
        description: 'Concatenate multiple buffers',
        parameters: [{ name: 'buffers', dataType: 'array', description: 'Array of base64-encoded buffers', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Concatenated base64-encoded buffer', example: 'buffer.concat [$buf1, $buf2]'
    },
    compare: {
        description: 'Compare two buffers (-1, 0, 1)',
        parameters: [
            { name: 'a', dataType: 'string', description: 'First buffer', formInputType: 'text', required: true },
            { name: 'b', dataType: 'string', description: 'Second buffer', formInputType: 'text', required: true }
        ],
        returnType: 'number', returnDescription: '-1, 0, or 1', example: 'buffer.compare $buf1 $buf2'
    },
    equals: {
        description: 'Check if two buffers are equal',
        parameters: [
            { name: 'a', dataType: 'string', description: 'First buffer', formInputType: 'text', required: true },
            { name: 'b', dataType: 'string', description: 'Second buffer', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if equal', example: 'buffer.equals $buf1 $buf2'
    },
    slice: {
        description: 'Get a slice of a buffer',
        parameters: [
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true },
            { name: 'start', dataType: 'number', description: 'Start index (default: 0)', formInputType: 'number', required: false, defaultValue: 0 },
            { name: 'end', dataType: 'number', description: 'End index (default: length)', formInputType: 'number', required: false }
        ],
        returnType: 'string', returnDescription: 'Base64-encoded slice', example: 'buffer.slice $buf 0 10'
    },
    length: {
        description: 'Get buffer length in bytes',
        parameters: [{ name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true }],
        returnType: 'number', returnDescription: 'Length in bytes', example: 'buffer.length $buf'
    },
    byteLength: {
        description: 'Get byte length of a string',
        parameters: [
            { name: 'string', dataType: 'string', description: 'Input string', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'number', returnDescription: 'Byte length', example: 'buffer.byteLength "hello"'
    },
    isBuffer: {
        description: 'Check if value is a valid base64 buffer',
        parameters: [{ name: 'value', dataType: 'any', description: 'Value to check', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if valid buffer', example: 'buffer.isBuffer $val'
    },
    fill: {
        description: 'Fill buffer with a value',
        parameters: [
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true },
            { name: 'value', dataType: 'number', description: 'Fill value', formInputType: 'number', required: true }
        ],
        returnType: 'string', returnDescription: 'Filled base64-encoded buffer', example: 'buffer.fill $buf 0'
    },
    indexOf: {
        description: 'Find position of a value in buffer',
        parameters: [
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true },
            { name: 'search', dataType: 'string', description: 'Value to find', formInputType: 'text', required: true }
        ],
        returnType: 'number', returnDescription: 'Index or -1', example: 'buffer.indexOf $buf "hello"'
    },
    copy: {
        description: 'Copy a buffer',
        parameters: [{ name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Copied base64-encoded buffer', example: 'buffer.copy $buf'
    },
    toHex: {
        description: 'Convert buffer to hex string',
        parameters: [{ name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Hex string', example: 'buffer.toHex $buf'
    },
    fromHex: {
        description: 'Create buffer from hex string',
        parameters: [{ name: 'hex', dataType: 'string', description: 'Hex string', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded buffer', example: 'buffer.fromHex "68656c6c6f"'
    }
};

export const BufferModuleMetadata = {
    description: 'Buffer operations for binary data: alloc, from, concat, compare, slice, encode/decode',
    methods: Object.keys(BufferFunctions)
};

export default {
    name: 'buffer',
    functions: BufferFunctions,
    functionMetadata: BufferFunctionMetadata,
    moduleMetadata: BufferModuleMetadata,
    global: false
};
