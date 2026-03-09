/**
 * Native TLS module for RobinPath.
 * TLS/SSL secure connections — required by databases, email, websockets.
 */
import { connect as _tlsConnect, createServer as _tlsCreateServer, TLSSocket } from 'node:tls';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toStr, toNum, requireArgs } from './_helpers.js';

const _sockets = new Map();
const _servers = new Map();
let _nextId = 1;

export const TlsFunctions = {

    connect: (args) => {
        requireArgs('tls.connect', args, 2);
        const host = toStr(args[0]);
        const port = toNum(args[1]);
        const opts = args[2] && typeof args[2] === 'object' ? args[2] : {};
        const id = `tls_${_nextId++}`;

        const tlsOpts = {
            host,
            port,
            rejectUnauthorized: opts.rejectUnauthorized !== false,
        };

        // Optional client certificates
        if (opts.cert) tlsOpts.cert = readFileSync(resolve(toStr(opts.cert)));
        if (opts.key) tlsOpts.key = readFileSync(resolve(toStr(opts.key)));
        if (opts.ca) tlsOpts.ca = readFileSync(resolve(toStr(opts.ca)));
        if (opts.servername) tlsOpts.servername = toStr(opts.servername);
        if (opts.minVersion) tlsOpts.minVersion = toStr(opts.minVersion);
        if (opts.maxVersion) tlsOpts.maxVersion = toStr(opts.maxVersion);

        return new Promise((resolve, reject) => {
            const socket = _tlsConnect(tlsOpts, () => {
                _sockets.set(id, { socket, data: '' });
                socket.on('data', (chunk) => {
                    const entry = _sockets.get(id);
                    if (entry) entry.data += chunk.toString();
                });
                socket.on('end', () => { _sockets.delete(id); });
                socket.on('error', () => { _sockets.delete(id); });
                resolve(id);
            });
            socket.on('error', (err) => reject(new Error(`tls.connect: ${err.message}`)));
        });
    },

    send: (args) => {
        requireArgs('tls.send', args, 2);
        const id = toStr(args[0]);
        const data = toStr(args[1]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.send: socket ${id} not found`);
        return new Promise((resolve, reject) => {
            entry.socket.write(data, (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    },

    read: (args) => {
        requireArgs('tls.read', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.read: socket ${id} not found`);
        const data = entry.data;
        entry.data = '';
        return data;
    },

    close: (args) => {
        requireArgs('tls.close', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (entry) {
            entry.socket.destroy();
            _sockets.delete(id);
            return true;
        }
        const server = _servers.get(id);
        if (server) {
            server.close();
            _servers.delete(id);
            return true;
        }
        return false;
    },

    createServer: (args, callback) => {
        requireArgs('tls.createServer', args, 1);
        const opts = args[0];
        if (typeof opts !== 'object' || opts === null) {
            throw new Error('tls.createServer requires options: {port, cert, key}');
        }
        const port = toNum(opts.port, 443);
        const host = toStr(opts.host || '0.0.0.0');
        const id = `tlss_${_nextId++}`;

        const serverOpts = {};
        if (opts.cert) serverOpts.cert = readFileSync(resolve(toStr(opts.cert)));
        if (opts.key) serverOpts.key = readFileSync(resolve(toStr(opts.key)));
        if (opts.ca) serverOpts.ca = readFileSync(resolve(toStr(opts.ca)));
        if (opts.requestCert) serverOpts.requestCert = true;

        const server = _tlsCreateServer(serverOpts, (socket) => {
            const connId = `tlsc_${_nextId++}`;
            _sockets.set(connId, { socket, data: '' });
            socket.on('data', (chunk) => {
                const entry = _sockets.get(connId);
                if (entry) entry.data += chunk.toString();
                if (callback) callback([connId, chunk.toString()]);
            });
            socket.on('end', () => { _sockets.delete(connId); });
            socket.on('error', () => { _sockets.delete(connId); });
        });

        server.listen(port, host);
        _servers.set(id, server);
        return id;
    },

    getCertificate: (args) => {
        requireArgs('tls.getCertificate', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.getCertificate: socket ${id} not found`);
        const cert = entry.socket.getPeerCertificate();
        return {
            subject: cert.subject,
            issuer: cert.issuer,
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            fingerprint: cert.fingerprint,
            fingerprint256: cert.fingerprint256,
            serialNumber: cert.serialNumber
        };
    },

    getPeerCertificate: (args) => {
        requireArgs('tls.getPeerCertificate', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.getPeerCertificate: socket ${id} not found`);
        const cert = entry.socket.getPeerCertificate(true);
        return {
            subject: cert.subject,
            issuer: cert.issuer,
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            fingerprint: cert.fingerprint,
            fingerprint256: cert.fingerprint256,
            serialNumber: cert.serialNumber,
            raw: cert.raw ? cert.raw.toString('base64') : null
        };
    },

    isEncrypted: (args) => {
        requireArgs('tls.isEncrypted', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) return false;
        return entry.socket.encrypted === true;
    },

    getProtocol: (args) => {
        requireArgs('tls.getProtocol', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.getProtocol: socket ${id} not found`);
        return entry.socket.getProtocol();
    },

    getCipher: (args) => {
        requireArgs('tls.getCipher', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`tls.getCipher: socket ${id} not found`);
        return entry.socket.getCipher();
    },

    active: () => ({
        sockets: Array.from(_sockets.keys()),
        servers: Array.from(_servers.keys())
    })
};

export const TlsFunctionMetadata = {
    connect: {
        description: 'Create a TLS/SSL connection',
        parameters: [
            { name: 'host', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true },
            { name: 'port', dataType: 'number', description: 'Port number', formInputType: 'number', required: true },
            { name: 'options', dataType: 'object', description: 'TLS options: cert, key, ca, rejectUnauthorized, servername', formInputType: 'json', required: false }
        ],
        returnType: 'string', returnDescription: 'TLS socket handle ID', example: 'tls.connect "smtp.gmail.com" 465'
    },
    send: {
        description: 'Send data over TLS socket',
        parameters: [
            { name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to send', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'tls.send $sock "EHLO example.com"'
    },
    read: {
        description: 'Read buffered TLS data',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Buffered data', example: 'tls.read $sock'
    },
    close: {
        description: 'Close TLS socket or server',
        parameters: [{ name: 'id', dataType: 'string', description: 'Socket or server handle', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if closed', example: 'tls.close $sock'
    },
    createServer: {
        description: 'Create a TLS server',
        parameters: [{ name: 'options', dataType: 'object', description: 'Server options: port, cert, key, ca', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Server handle ID', example: 'tls.createServer {"port": 443, "cert": "cert.pem", "key": "key.pem"}'
    },
    getCertificate: {
        description: 'Get peer TLS certificate info',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Certificate details', example: 'tls.getCertificate $sock'
    },
    getPeerCertificate: {
        description: 'Get full peer certificate with raw data',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Full certificate object', example: 'tls.getPeerCertificate $sock'
    },
    isEncrypted: {
        description: 'Check if socket is TLS encrypted',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if encrypted', example: 'tls.isEncrypted $sock'
    },
    getProtocol: {
        description: 'Get TLS protocol version (e.g. TLSv1.3)',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Protocol version string', example: 'tls.getProtocol $sock'
    },
    getCipher: {
        description: 'Get current cipher info',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Cipher name and version', example: 'tls.getCipher $sock'
    },
    active: { description: 'List active TLS sockets and servers', parameters: [], returnType: 'object', returnDescription: '{sockets, servers}', example: 'tls.active' }
};

export const TlsModuleMetadata = {
    description: 'TLS/SSL: secure connections, certificates, encrypted client/server sockets',
    methods: Object.keys(TlsFunctions)
};

export default {
    name: 'tls',
    functions: TlsFunctions,
    functionMetadata: TlsFunctionMetadata,
    moduleMetadata: TlsModuleMetadata,
    global: false
};
