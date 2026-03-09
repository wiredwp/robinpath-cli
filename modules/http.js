/**
 * Native HTTP module for RobinPath.
 * HTTP client (fetch-based) and server (Node.js http).
 */
import { createServer } from 'node:http';
import { toStr, toNum, requireArgs } from './_helpers.js';

const _servers = new Map();
let _nextId = 1;

async function doFetch(url, method, bodyArg, headersArg) {
    const opts = { method };

    // Headers
    const headers = {};
    if (headersArg && typeof headersArg === 'object') {
        for (const [k, v] of Object.entries(headersArg)) headers[k] = toStr(v);
    }

    // Body
    if (bodyArg != null && method !== 'GET' && method !== 'HEAD') {
        if (typeof bodyArg === 'object') {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            opts.body = JSON.stringify(bodyArg);
        } else {
            opts.body = toStr(bodyArg);
        }
    }

    opts.headers = headers;

    const res = await fetch(url, opts);
    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
        try { data = await res.json(); } catch { data = await res.text(); }
    } else {
        data = await res.text();
    }

    return {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        data,
        ok: res.ok,
        url: res.url
    };
}

export const HttpFunctions = {

    get: async (args) => {
        requireArgs('http.get', args, 1);
        return doFetch(toStr(args[0]), 'GET', null, args[1]);
    },

    post: async (args) => {
        requireArgs('http.post', args, 1);
        return doFetch(toStr(args[0]), 'POST', args[1], args[2]);
    },

    put: async (args) => {
        requireArgs('http.put', args, 1);
        return doFetch(toStr(args[0]), 'PUT', args[1], args[2]);
    },

    patch: async (args) => {
        requireArgs('http.patch', args, 1);
        return doFetch(toStr(args[0]), 'PATCH', args[1], args[2]);
    },

    delete: async (args) => {
        requireArgs('http.delete', args, 1);
        return doFetch(toStr(args[0]), 'DELETE', args[1], args[2]);
    },

    head: async (args) => {
        requireArgs('http.head', args, 1);
        const res = await fetch(toStr(args[0]), { method: 'HEAD' });
        return {
            status: res.status,
            statusText: res.statusText,
            headers: Object.fromEntries(res.headers.entries()),
            ok: res.ok
        };
    },

    request: async (args) => {
        requireArgs('http.request', args, 1);
        const opts = args[0];
        if (typeof opts !== 'object' || opts === null) {
            throw new Error('http.request requires an options object: {url, method, body?, headers?}');
        }
        const url = toStr(opts.url || opts.href);
        const method = toStr(opts.method || 'GET').toUpperCase();
        return doFetch(url, method, opts.body || opts.data, opts.headers);
    },

    serve: (args, callback) => {
        requireArgs('http.serve', args, 1);
        const port = toNum(args[0], 3000);
        const host = toStr(args[1], '0.0.0.0');
        const id = `http_${_nextId++}`;

        const server = createServer(async (req, res) => {
            const body = await new Promise((resolve) => {
                let data = '';
                req.on('data', (chunk) => { data += chunk; });
                req.on('end', () => resolve(data));
            });

            let parsedBody = body;
            try { parsedBody = JSON.parse(body); } catch { /* raw string */ }

            const request = {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: parsedBody
            };

            if (callback) {
                try {
                    const result = await callback([request]);
                    const statusCode = (result && result.status) ? result.status : 200;
                    const respHeaders = (result && result.headers) ? result.headers : { 'Content-Type': 'application/json' };
                    const respBody = (result && result.body != null) ? result.body : result;
                    res.writeHead(statusCode, respHeaders);
                    res.end(typeof respBody === 'object' ? JSON.stringify(respBody) : toStr(respBody));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(request));
            }
        });

        server.listen(port, host);
        _servers.set(id, server);
        return id;
    },

    close: (args) => {
        requireArgs('http.close', args, 1);
        const id = toStr(args[0]);
        const server = _servers.get(id);
        if (server) {
            server.close();
            _servers.delete(id);
            return true;
        }
        return false;
    },

    servers: () => Array.from(_servers.keys()),

    download: async (args) => {
        requireArgs('http.download', args, 2);
        const url = toStr(args[0]);
        const filePath = toStr(args[1]);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`http.download: ${res.status} ${res.statusText}`);
        const { writeFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        const buffer = Buffer.from(await res.arrayBuffer());
        await writeFile(resolve(filePath), buffer);
        return { size: buffer.length, path: filePath, status: res.status };
    }
};

export const HttpFunctionMetadata = {
    get: {
        description: 'HTTP GET request',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL to request', formInputType: 'text', required: true },
            { name: 'headers', dataType: 'object', description: 'Request headers', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Response with status, headers, data', example: 'http.get "https://api.example.com/data"'
    },
    post: {
        description: 'HTTP POST request',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL', formInputType: 'text', required: true },
            { name: 'body', dataType: 'any', description: 'Request body (object auto-serialized to JSON)', formInputType: 'json', required: false },
            { name: 'headers', dataType: 'object', description: 'Request headers', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Response with status, headers, data', example: 'http.post "https://api.example.com/data" {"key": "value"}'
    },
    put: {
        description: 'HTTP PUT request',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL', formInputType: 'text', required: true },
            { name: 'body', dataType: 'any', description: 'Request body', formInputType: 'json', required: false },
            { name: 'headers', dataType: 'object', description: 'Headers', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Response', example: 'http.put "https://api.example.com/data/1" {"key": "new"}'
    },
    patch: {
        description: 'HTTP PATCH request',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL', formInputType: 'text', required: true },
            { name: 'body', dataType: 'any', description: 'Request body', formInputType: 'json', required: false },
            { name: 'headers', dataType: 'object', description: 'Headers', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Response', example: 'http.patch "https://api.example.com/data/1" {"key": "updated"}'
    },
    delete: {
        description: 'HTTP DELETE request',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL', formInputType: 'text', required: true },
            { name: 'body', dataType: 'any', description: 'Request body', formInputType: 'json', required: false },
            { name: 'headers', dataType: 'object', description: 'Headers', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Response', example: 'http.delete "https://api.example.com/data/1"'
    },
    head: {
        description: 'HTTP HEAD request (headers only)',
        parameters: [{ name: 'url', dataType: 'string', description: 'URL', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Response with status and headers', example: 'http.head "https://example.com"'
    },
    request: {
        description: 'Custom HTTP request with full options',
        parameters: [{ name: 'options', dataType: 'object', description: 'Object with url, method, body, headers', formInputType: 'json', required: true }],
        returnType: 'object', returnDescription: 'Response', example: 'http.request {"url": "https://api.example.com", "method": "POST", "body": {"key": 1}}'
    },
    serve: {
        description: 'Start an HTTP server',
        parameters: [
            { name: 'port', dataType: 'number', description: 'Port to listen on (default: 3000)', formInputType: 'number', required: true },
            { name: 'host', dataType: 'string', description: 'Host (default: 0.0.0.0)', formInputType: 'text', required: false, defaultValue: '0.0.0.0' }
        ],
        returnType: 'string', returnDescription: 'Server handle ID', example: 'http.serve 8080'
    },
    close: {
        description: 'Close an HTTP server',
        parameters: [{ name: 'serverId', dataType: 'string', description: 'Server handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if closed', example: 'http.close $serverId'
    },
    servers: {
        description: 'List all running HTTP servers',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of server IDs', example: 'http.servers'
    },
    download: {
        description: 'Download a file from a URL',
        parameters: [
            { name: 'url', dataType: 'string', description: 'URL to download', formInputType: 'text', required: true },
            { name: 'path', dataType: 'string', description: 'Local file path to save', formInputType: 'text', required: true }
        ],
        returnType: 'object', returnDescription: 'Object with size, path, status', example: 'http.download "https://example.com/file.zip" "file.zip"'
    }
};

export const HttpModuleMetadata = {
    description: 'HTTP client and server: GET, POST, PUT, DELETE, serve, download',
    methods: Object.keys(HttpFunctions)
};

export default {
    name: 'http',
    functions: HttpFunctions,
    functionMetadata: HttpFunctionMetadata,
    moduleMetadata: HttpModuleMetadata,
    global: false
};
