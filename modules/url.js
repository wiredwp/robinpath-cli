/**
 * Native URL module for RobinPath.
 * URL parsing, formatting, and encoding utilities.
 */
import { toStr, requireArgs } from './_helpers.js';

export const UrlFunctions = {

    parse: (args) => {
        requireArgs('url.parse', args, 1);
        const urlStr = toStr(args[0]);
        const u = new URL(urlStr);
        return {
            href: u.href,
            protocol: u.protocol,
            hostname: u.hostname,
            host: u.host,
            port: u.port || null,
            pathname: u.pathname,
            search: u.search,
            hash: u.hash,
            origin: u.origin,
            username: u.username,
            password: u.password
        };
    },

    format: (args) => {
        requireArgs('url.format', args, 1);
        const obj = args[0];
        if (typeof obj === 'string') return obj;
        if (typeof obj !== 'object' || obj === null) {
            throw new Error('url.format requires a URL object or string');
        }
        const u = new URL(obj.href || `${obj.protocol || 'https:'}//${obj.hostname || 'localhost'}`);
        if (obj.port) u.port = String(obj.port);
        if (obj.pathname) u.pathname = obj.pathname;
        if (obj.search) u.search = obj.search;
        if (obj.hash) u.hash = obj.hash;
        if (obj.username) u.username = obj.username;
        if (obj.password) u.password = obj.password;
        return u.href;
    },

    resolve: (args) => {
        requireArgs('url.resolve', args, 2);
        const base = toStr(args[0]);
        const relative = toStr(args[1]);
        return new URL(relative, base).href;
    },

    searchParams: (args) => {
        requireArgs('url.searchParams', args, 1);
        const urlStr = toStr(args[0]);
        const u = new URL(urlStr);
        const result = {};
        for (const [key, value] of u.searchParams) {
            result[key] = value;
        }
        return result;
    },

    buildQuery: (args) => {
        requireArgs('url.buildQuery', args, 1);
        const obj = args[0];
        if (typeof obj !== 'object' || obj === null) {
            throw new Error('url.buildQuery requires an object');
        }
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(obj)) {
            params.append(key, String(value));
        }
        return params.toString();
    },

    encode: (args) => {
        requireArgs('url.encode', args, 1);
        return encodeURIComponent(toStr(args[0]));
    },

    decode: (args) => {
        requireArgs('url.decode', args, 1);
        return decodeURIComponent(toStr(args[0]));
    },

    encodeFull: (args) => {
        requireArgs('url.encodeFull', args, 1);
        return encodeURI(toStr(args[0]));
    },

    decodeFull: (args) => {
        requireArgs('url.decodeFull', args, 1);
        return decodeURI(toStr(args[0]));
    },

    isValid: (args) => {
        requireArgs('url.isValid', args, 1);
        try {
            new URL(toStr(args[0]));
            return true;
        } catch {
            return false;
        }
    },

    join: (args) => {
        requireArgs('url.join', args, 2);
        const base = toStr(args[0]).replace(/\/+$/, '');
        const parts = args.slice(1).map(a => toStr(a).replace(/^\/+|\/+$/g, ''));
        return base + '/' + parts.join('/');
    }
};

export const UrlFunctionMetadata = {
    parse: {
        description: 'Parse a URL into components',
        parameters: [{ name: 'url', dataType: 'string', description: 'URL string', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Object with protocol, hostname, port, pathname, search, hash', example: 'url.parse "https://example.com/path?q=1"'
    },
    format: {
        description: 'Format a URL object into a string',
        parameters: [{ name: 'urlObject', dataType: 'object', description: 'URL components object', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Formatted URL string', example: 'url.format $urlObj'
    },
    resolve: {
        description: 'Resolve a relative URL against a base',
        parameters: [
            { name: 'base', dataType: 'string', description: 'Base URL', formInputType: 'text', required: true },
            { name: 'relative', dataType: 'string', description: 'Relative URL', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Resolved URL', example: 'url.resolve "https://example.com" "/path"'
    },
    searchParams: {
        description: 'Extract query parameters as an object',
        parameters: [{ name: 'url', dataType: 'string', description: 'URL string', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Key-value object of query parameters', example: 'url.searchParams "https://example.com?a=1&b=2"'
    },
    buildQuery: {
        description: 'Build a query string from an object',
        parameters: [{ name: 'params', dataType: 'object', description: 'Key-value pairs', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Query string (without ?)', example: 'url.buildQuery {"a": 1, "b": 2}'
    },
    encode: {
        description: 'URL-encode a string component',
        parameters: [{ name: 'value', dataType: 'string', description: 'String to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Encoded string', example: 'url.encode "hello world"'
    },
    decode: {
        description: 'URL-decode a string component',
        parameters: [{ name: 'value', dataType: 'string', description: 'String to decode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decoded string', example: 'url.decode "hello%20world"'
    },
    encodeFull: {
        description: 'Encode a full URI',
        parameters: [{ name: 'uri', dataType: 'string', description: 'URI to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Encoded URI', example: 'url.encodeFull "https://example.com/path with spaces"'
    },
    decodeFull: {
        description: 'Decode a full URI',
        parameters: [{ name: 'uri', dataType: 'string', description: 'URI to decode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decoded URI', example: 'url.decodeFull "https://example.com/path%20with%20spaces"'
    },
    isValid: {
        description: 'Check if a string is a valid URL',
        parameters: [{ name: 'url', dataType: 'string', description: 'String to check', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if valid URL', example: 'url.isValid "https://example.com"'
    },
    join: {
        description: 'Join URL path segments',
        parameters: [
            { name: 'base', dataType: 'string', description: 'Base URL', formInputType: 'text', required: true },
            { name: 'segments', dataType: 'string', description: 'Path segments', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Joined URL', example: 'url.join "https://api.example.com" "v1" "users"'
    }
};

export const UrlModuleMetadata = {
    description: 'URL parsing, formatting, encoding, and query string utilities',
    methods: Object.keys(UrlFunctions)
};

export default {
    name: 'url',
    functions: UrlFunctions,
    functionMetadata: UrlFunctionMetadata,
    moduleMetadata: UrlModuleMetadata,
    global: false
};
