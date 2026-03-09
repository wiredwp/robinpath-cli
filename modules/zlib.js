/**
 * Native zlib module for RobinPath.
 * Compression and decompression utilities.
 */
import {
    gzip as _gzip, gunzip as _gunzip,
    deflate as _deflate, inflate as _inflate,
    brotliCompress as _brotliCompress, brotliDecompress as _brotliDecompress
} from 'node:zlib';
import { toStr, requireArgs } from './_helpers.js';

function promisify(fn, input) {
    return new Promise((resolve, reject) => {
        fn(input, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

export const ZlibFunctions = {

    gzip: async (args) => {
        requireArgs('zlib.gzip', args, 1);
        const input = Buffer.from(toStr(args[0]));
        const result = await promisify(_gzip, input);
        return result.toString('base64');
    },

    gunzip: async (args) => {
        requireArgs('zlib.gunzip', args, 1);
        const input = Buffer.from(toStr(args[0]), 'base64');
        const result = await promisify(_gunzip, input);
        return result.toString('utf-8');
    },

    deflate: async (args) => {
        requireArgs('zlib.deflate', args, 1);
        const input = Buffer.from(toStr(args[0]));
        const result = await promisify(_deflate, input);
        return result.toString('base64');
    },

    inflate: async (args) => {
        requireArgs('zlib.inflate', args, 1);
        const input = Buffer.from(toStr(args[0]), 'base64');
        const result = await promisify(_inflate, input);
        return result.toString('utf-8');
    },

    brotliCompress: async (args) => {
        requireArgs('zlib.brotliCompress', args, 1);
        const input = Buffer.from(toStr(args[0]));
        const result = await promisify(_brotliCompress, input);
        return result.toString('base64');
    },

    brotliDecompress: async (args) => {
        requireArgs('zlib.brotliDecompress', args, 1);
        const input = Buffer.from(toStr(args[0]), 'base64');
        const result = await promisify(_brotliDecompress, input);
        return result.toString('utf-8');
    },

    compressSize: async (args) => {
        requireArgs('zlib.compressSize', args, 1);
        const input = Buffer.from(toStr(args[0]));
        const compressed = await promisify(_gzip, input);
        return {
            original: input.length,
            compressed: compressed.length,
            ratio: Math.round(compressed.length / input.length * 10000) / 100
        };
    }
};

export const ZlibFunctionMetadata = {
    gzip: {
        description: 'Gzip compress a string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to compress', formInputType: 'textarea', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded gzipped data', example: 'zlib.gzip "hello world"'
    },
    gunzip: {
        description: 'Decompress gzipped data',
        parameters: [{ name: 'data', dataType: 'string', description: 'Base64-encoded gzipped data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decompressed string', example: 'zlib.gunzip $compressed'
    },
    deflate: {
        description: 'Deflate compress a string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to compress', formInputType: 'textarea', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded deflated data', example: 'zlib.deflate "hello world"'
    },
    inflate: {
        description: 'Decompress deflated data',
        parameters: [{ name: 'data', dataType: 'string', description: 'Base64-encoded deflated data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decompressed string', example: 'zlib.inflate $compressed'
    },
    brotliCompress: {
        description: 'Brotli compress a string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to compress', formInputType: 'textarea', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded brotli data', example: 'zlib.brotliCompress "hello world"'
    },
    brotliDecompress: {
        description: 'Decompress brotli data',
        parameters: [{ name: 'data', dataType: 'string', description: 'Base64-encoded brotli data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decompressed string', example: 'zlib.brotliDecompress $compressed'
    },
    compressSize: {
        description: 'Show compression ratio (gzip)',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to analyze', formInputType: 'textarea', required: true }],
        returnType: 'object', returnDescription: 'Object with original, compressed, ratio', example: 'zlib.compressSize "hello world hello world"'
    }
};

export const ZlibModuleMetadata = {
    description: 'Compression: gzip, deflate, brotli compress/decompress',
    methods: Object.keys(ZlibFunctions)
};

export default {
    name: 'zlib',
    functions: ZlibFunctions,
    functionMetadata: ZlibFunctionMetadata,
    moduleMetadata: ZlibModuleMetadata,
    global: false
};
