/**
 * Native stream module for RobinPath.
 * Readable, Writable, Transform, Duplex, PassThrough, and pipeline.
 */
import { Readable, Writable, Transform, Duplex, PassThrough, pipeline as _pipeline } from 'node:stream';
import { toStr, toNum, requireArgs } from './_helpers.js';

const _streams = new Map();
let _nextId = 1;

export const StreamFunctions = {

    readable: (args) => {
        const data = args[0];
        const id = `readable_${_nextId++}`;
        let chunks;
        if (typeof data === 'string') {
            chunks = [data];
        } else if (Array.isArray(data)) {
            chunks = data.map(c => toStr(c));
        } else {
            chunks = [toStr(data)];
        }
        const stream = new Readable({
            read() {
                if (chunks.length > 0) this.push(chunks.shift());
                else this.push(null);
            }
        });
        _streams.set(id, { stream, data: '' });
        stream.on('data', (chunk) => {
            const entry = _streams.get(id);
            if (entry) entry.data += chunk.toString();
        });
        return id;
    },

    writable: (args) => {
        const id = `writable_${_nextId++}`;
        let collected = '';
        const stream = new Writable({
            write(chunk, encoding, callback) {
                collected += chunk.toString();
                const entry = _streams.get(id);
                if (entry) entry.data = collected;
                callback();
            }
        });
        _streams.set(id, { stream, data: '' });
        return id;
    },

    transform: (args) => {
        const id = `transform_${_nextId++}`;
        const stream = new Transform({
            transform(chunk, encoding, callback) {
                callback(null, chunk);
            }
        });
        _streams.set(id, { stream, data: '' });
        stream.on('data', (chunk) => {
            const entry = _streams.get(id);
            if (entry) entry.data += chunk.toString();
        });
        return id;
    },

    duplex: (args) => {
        const id = `duplex_${_nextId++}`;
        const stream = new Duplex({
            read() {},
            write(chunk, encoding, callback) {
                this.push(chunk);
                callback();
            }
        });
        _streams.set(id, { stream, data: '' });
        stream.on('data', (chunk) => {
            const entry = _streams.get(id);
            if (entry) entry.data += chunk.toString();
        });
        return id;
    },

    passThrough: (args) => {
        const id = `passthrough_${_nextId++}`;
        const stream = new PassThrough();
        _streams.set(id, { stream, data: '' });
        stream.on('data', (chunk) => {
            const entry = _streams.get(id);
            if (entry) entry.data += chunk.toString();
        });
        return id;
    },

    write: (args) => {
        requireArgs('stream.write', args, 2);
        const id = toStr(args[0]);
        const data = toStr(args[1]);
        const entry = _streams.get(id);
        if (!entry) throw new Error(`stream.write: stream ${id} not found`);
        return new Promise((resolve, reject) => {
            entry.stream.write(data, (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    },

    read: (args) => {
        requireArgs('stream.read', args, 1);
        const id = toStr(args[0]);
        const entry = _streams.get(id);
        if (!entry) throw new Error(`stream.read: stream ${id} not found`);
        const data = entry.data;
        entry.data = '';
        return data;
    },

    end: (args) => {
        requireArgs('stream.end', args, 1);
        const id = toStr(args[0]);
        const entry = _streams.get(id);
        if (!entry) throw new Error(`stream.end: stream ${id} not found`);
        entry.stream.end();
        return true;
    },

    destroy: (args) => {
        requireArgs('stream.destroy', args, 1);
        const id = toStr(args[0]);
        const entry = _streams.get(id);
        if (entry) {
            entry.stream.destroy();
            _streams.delete(id);
            return true;
        }
        return false;
    },

    pipe: (args) => {
        requireArgs('stream.pipe', args, 2);
        const srcId = toStr(args[0]);
        const destId = toStr(args[1]);
        const src = _streams.get(srcId);
        const dest = _streams.get(destId);
        if (!src) throw new Error(`stream.pipe: source ${srcId} not found`);
        if (!dest) throw new Error(`stream.pipe: destination ${destId} not found`);
        src.stream.pipe(dest.stream);
        return destId;
    },

    pipeline: (args) => {
        if (!Array.isArray(args[0]) && args.length < 2) {
            throw new Error('stream.pipeline requires at least 2 stream IDs');
        }
        const ids = Array.isArray(args[0]) ? args[0] : args;
        const streams = ids.map(id => {
            const entry = _streams.get(toStr(id));
            if (!entry) throw new Error(`stream.pipeline: stream ${id} not found`);
            return entry.stream;
        });
        return new Promise((resolve, reject) => {
            _pipeline(...streams, (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    },

    toBuffer: (args) => {
        requireArgs('stream.toBuffer', args, 1);
        const id = toStr(args[0]);
        const entry = _streams.get(id);
        if (!entry) throw new Error(`stream.toBuffer: stream ${id} not found`);
        return new Promise((resolve) => {
            const chunks = [];
            entry.stream.on('data', (chunk) => chunks.push(chunk));
            entry.stream.on('end', () => {
                resolve(Buffer.concat(chunks).toString('base64'));
            });
            // If already ended
            if (entry.stream.readableEnded) {
                resolve(Buffer.from(entry.data).toString('base64'));
            }
        });
    },

    toString: (args) => {
        requireArgs('stream.toString', args, 1);
        const id = toStr(args[0]);
        const entry = _streams.get(id);
        if (!entry) throw new Error(`stream.toString: stream ${id} not found`);
        return new Promise((resolve) => {
            let data = '';
            entry.stream.on('data', (chunk) => { data += chunk.toString(); });
            entry.stream.on('end', () => resolve(data));
            if (entry.stream.readableEnded) resolve(entry.data);
        });
    },

    fromString: (args) => {
        requireArgs('stream.fromString', args, 1);
        const data = toStr(args[0]);
        const id = `readable_${_nextId++}`;
        const stream = Readable.from([data]);
        _streams.set(id, { stream, data });
        return id;
    },

    fromArray: (args) => {
        requireArgs('stream.fromArray', args, 1);
        const arr = Array.isArray(args[0]) ? args[0] : [args[0]];
        const id = `readable_${_nextId++}`;
        const stream = Readable.from(arr.map(a => toStr(a)));
        _streams.set(id, { stream, data: arr.join('') });
        return id;
    },

    active: () => Array.from(_streams.keys()),

    count: () => _streams.size
};

export const StreamFunctionMetadata = {
    readable: {
        description: 'Create a readable stream from data',
        parameters: [{ name: 'data', dataType: 'any', description: 'String or array of chunks', formInputType: 'textarea', required: true }],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.readable "hello world"'
    },
    writable: {
        description: 'Create a writable stream that collects data',
        parameters: [],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.writable'
    },
    transform: {
        description: 'Create a transform (pass-through) stream',
        parameters: [],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.transform'
    },
    duplex: {
        description: 'Create a duplex (read/write) stream',
        parameters: [],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.duplex'
    },
    passThrough: {
        description: 'Create a passthrough stream',
        parameters: [],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.passThrough'
    },
    write: {
        description: 'Write data to a stream',
        parameters: [
            { name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to write', formInputType: 'textarea', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'stream.write $s "data"'
    },
    read: {
        description: 'Read buffered data from a stream',
        parameters: [{ name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Buffered data', example: 'stream.read $s'
    },
    end: {
        description: 'Signal end of stream',
        parameters: [{ name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true', example: 'stream.end $s'
    },
    destroy: {
        description: 'Destroy a stream and free resources',
        parameters: [{ name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if destroyed', example: 'stream.destroy $s'
    },
    pipe: {
        description: 'Pipe one stream into another',
        parameters: [
            { name: 'sourceId', dataType: 'string', description: 'Source stream', formInputType: 'text', required: true },
            { name: 'destId', dataType: 'string', description: 'Destination stream', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Destination stream ID', example: 'stream.pipe $src $dest'
    },
    pipeline: {
        description: 'Chain multiple streams together with error propagation',
        parameters: [{ name: 'streamIds', dataType: 'array', description: 'Array of stream IDs to chain', formInputType: 'json', required: true }],
        returnType: 'boolean', returnDescription: 'true on completion', example: 'stream.pipeline [$s1, $s2, $s3]'
    },
    toBuffer: {
        description: 'Collect stream data as base64 buffer',
        parameters: [{ name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Base64-encoded buffer', example: 'stream.toBuffer $s'
    },
    toString: {
        description: 'Collect stream data as string',
        parameters: [{ name: 'streamId', dataType: 'string', description: 'Stream handle ID', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Collected string', example: 'stream.toString $s'
    },
    fromString: {
        description: 'Create a readable stream from a string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Input string', formInputType: 'textarea', required: true }],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.fromString "hello"'
    },
    fromArray: {
        description: 'Create a readable stream from an array',
        parameters: [{ name: 'data', dataType: 'array', description: 'Array of chunks', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Stream handle ID', example: 'stream.fromArray ["chunk1", "chunk2"]'
    },
    active: { description: 'List all active stream handles', parameters: [], returnType: 'array', returnDescription: 'Array of stream IDs', example: 'stream.active' },
    count: { description: 'Count active streams', parameters: [], returnType: 'number', returnDescription: 'Number of active streams', example: 'stream.count' }
};

export const StreamModuleMetadata = {
    description: 'Stream operations: Readable, Writable, Transform, Duplex, PassThrough, pipe, pipeline',
    methods: Object.keys(StreamFunctions)
};

export default {
    name: 'stream',
    functions: StreamFunctions,
    functionMetadata: StreamFunctionMetadata,
    moduleMetadata: StreamModuleMetadata,
    global: false
};
