/**
 * Native string_decoder module for RobinPath.
 * Decode Buffer sequences to strings, handling multi-byte characters.
 */
import { StringDecoder } from 'node:string_decoder';
import { toStr, requireArgs } from './_helpers.js';

const _decoders = new Map();
let _nextId = 1;

export const StringDecoderFunctions = {

    create: (args) => {
        const encoding = toStr(args[0], 'utf-8');
        const id = `decoder_${_nextId++}`;
        _decoders.set(id, new StringDecoder(encoding));
        return id;
    },

    write: (args) => {
        requireArgs('stringDecoder.write', args, 2);
        const id = toStr(args[0]);
        const decoder = _decoders.get(id);
        if (!decoder) throw new Error(`stringDecoder.write: decoder ${id} not found`);
        const buf = Buffer.from(toStr(args[1]), 'base64');
        return decoder.write(buf);
    },

    end: (args) => {
        requireArgs('stringDecoder.end', args, 1);
        const id = toStr(args[0]);
        const decoder = _decoders.get(id);
        if (!decoder) throw new Error(`stringDecoder.end: decoder ${id} not found`);
        const result = decoder.end();
        _decoders.delete(id);
        return result;
    },

    decode: (args) => {
        requireArgs('stringDecoder.decode', args, 1);
        const encoding = toStr(args[1], 'utf-8');
        const buf = Buffer.from(toStr(args[0]), 'base64');
        const decoder = new StringDecoder(encoding);
        return decoder.write(buf) + decoder.end();
    },

    destroy: (args) => {
        requireArgs('stringDecoder.destroy', args, 1);
        const id = toStr(args[0]);
        if (_decoders.has(id)) {
            _decoders.delete(id);
            return true;
        }
        return false;
    },

    active: () => Array.from(_decoders.keys())
};

export const StringDecoderFunctionMetadata = {
    create: {
        description: 'Create a string decoder for an encoding',
        parameters: [{ name: 'encoding', dataType: 'string', description: 'Encoding (utf-8, ascii, base64, hex, etc.)', formInputType: 'text', required: false, defaultValue: 'utf-8' }],
        returnType: 'string', returnDescription: 'Decoder handle ID', example: 'stringDecoder.create "utf-8"'
    },
    write: {
        description: 'Write buffer data through decoder',
        parameters: [
            { name: 'decoderId', dataType: 'string', description: 'Decoder handle', formInputType: 'text', required: true },
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer data', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Decoded string', example: 'stringDecoder.write $dec $buf'
    },
    end: {
        description: 'Flush remaining bytes and close decoder',
        parameters: [{ name: 'decoderId', dataType: 'string', description: 'Decoder handle', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Any remaining decoded bytes', example: 'stringDecoder.end $dec'
    },
    decode: {
        description: 'One-shot decode: buffer to string',
        parameters: [
            { name: 'buffer', dataType: 'string', description: 'Base64-encoded buffer', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'string', returnDescription: 'Decoded string', example: 'stringDecoder.decode $buf "utf-8"'
    },
    destroy: {
        description: 'Destroy a decoder',
        parameters: [{ name: 'decoderId', dataType: 'string', description: 'Decoder handle', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if destroyed', example: 'stringDecoder.destroy $dec'
    },
    active: { description: 'List active decoders', parameters: [], returnType: 'array', returnDescription: 'Array of decoder IDs', example: 'stringDecoder.active' }
};

export const StringDecoderModuleMetadata = {
    description: 'String decoder: convert Buffer sequences to strings with multi-byte character handling',
    methods: Object.keys(StringDecoderFunctions)
};

export default {
    name: 'stringDecoder',
    functions: StringDecoderFunctions,
    functionMetadata: StringDecoderFunctionMetadata,
    moduleMetadata: StringDecoderModuleMetadata,
    global: false
};
