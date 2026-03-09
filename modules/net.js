/**
 * Native net module for RobinPath.
 * TCP client/server and socket operations.
 */
import { createServer, createConnection, isIP, isIPv4, isIPv6 } from 'node:net';
import { toStr, toNum, requireArgs } from './_helpers.js';

const _servers = new Map();
const _sockets = new Map();
let _nextId = 1;

export const NetFunctions = {

    connect: (args) => {
        requireArgs('net.connect', args, 2);
        const host = toStr(args[0]);
        const port = toNum(args[1]);
        const id = `sock_${_nextId++}`;

        return new Promise((resolve, reject) => {
            const socket = createConnection({ host, port }, () => {
                _sockets.set(id, { socket, data: '' });
                socket.on('data', (chunk) => {
                    const entry = _sockets.get(id);
                    if (entry) entry.data += chunk.toString();
                });
                socket.on('end', () => { _sockets.delete(id); });
                socket.on('error', () => { _sockets.delete(id); });
                resolve(id);
            });
            socket.on('error', (err) => reject(new Error(`net.connect: ${err.message}`)));
        });
    },

    send: (args) => {
        requireArgs('net.send', args, 2);
        const id = toStr(args[0]);
        const data = toStr(args[1]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`net.send: socket ${id} not found`);
        return new Promise((resolve, reject) => {
            entry.socket.write(data, (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    },

    read: (args) => {
        requireArgs('net.read', args, 1);
        const id = toStr(args[0]);
        const entry = _sockets.get(id);
        if (!entry) throw new Error(`net.read: socket ${id} not found`);
        const data = entry.data;
        entry.data = '';
        return data;
    },

    close: (args) => {
        requireArgs('net.close', args, 1);
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
        requireArgs('net.createServer', args, 1);
        const port = toNum(args[0]);
        const host = toStr(args[1], '0.0.0.0');
        const serverId = `tcp_${_nextId++}`;

        const server = createServer((socket) => {
            const connId = `conn_${_nextId++}`;
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
        _servers.set(serverId, server);
        return serverId;
    },

    isIP: (args) => {
        requireArgs('net.isIP', args, 1);
        return isIP(toStr(args[0]));
    },

    isIPv4: (args) => {
        requireArgs('net.isIPv4', args, 1);
        return isIPv4(toStr(args[0]));
    },

    isIPv6: (args) => {
        requireArgs('net.isIPv6', args, 1);
        return isIPv6(toStr(args[0]));
    },

    active: () => ({
        servers: Array.from(_servers.keys()),
        sockets: Array.from(_sockets.keys())
    })
};

export const NetFunctionMetadata = {
    connect: {
        description: 'Connect to a TCP server',
        parameters: [
            { name: 'host', dataType: 'string', description: 'Host to connect to', formInputType: 'text', required: true },
            { name: 'port', dataType: 'number', description: 'Port number', formInputType: 'number', required: true }
        ],
        returnType: 'string', returnDescription: 'Socket handle ID', example: 'net.connect "localhost" 8080'
    },
    send: {
        description: 'Send data through a socket',
        parameters: [
            { name: 'socketId', dataType: 'string', description: 'Socket handle ID', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to send', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'net.send $sock "hello"'
    },
    read: {
        description: 'Read buffered data from a socket',
        parameters: [{ name: 'socketId', dataType: 'string', description: 'Socket handle ID', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Buffered data', example: 'net.read $sock'
    },
    close: {
        description: 'Close a socket or server',
        parameters: [{ name: 'id', dataType: 'string', description: 'Socket or server handle ID', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if closed', example: 'net.close $sock'
    },
    createServer: {
        description: 'Create a TCP server',
        parameters: [
            { name: 'port', dataType: 'number', description: 'Port to listen on', formInputType: 'number', required: true },
            { name: 'host', dataType: 'string', description: 'Host (default: 0.0.0.0)', formInputType: 'text', required: false, defaultValue: '0.0.0.0' }
        ],
        returnType: 'string', returnDescription: 'Server handle ID', example: 'net.createServer 9090'
    },
    isIP: {
        description: 'Check if string is a valid IP (returns 0, 4, or 6)',
        parameters: [{ name: 'address', dataType: 'string', description: 'Address to check', formInputType: 'text', required: true }],
        returnType: 'number', returnDescription: '0 (invalid), 4 (IPv4), or 6 (IPv6)', example: 'net.isIP "192.168.1.1"'
    },
    isIPv4: {
        description: 'Check if string is a valid IPv4 address',
        parameters: [{ name: 'address', dataType: 'string', description: 'Address', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if IPv4', example: 'net.isIPv4 "192.168.1.1"'
    },
    isIPv6: {
        description: 'Check if string is a valid IPv6 address',
        parameters: [{ name: 'address', dataType: 'string', description: 'Address', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if IPv6', example: 'net.isIPv6 "::1"'
    },
    active: {
        description: 'List active servers and sockets',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with servers and sockets arrays', example: 'net.active'
    }
};

export const NetModuleMetadata = {
    description: 'TCP networking: connect, send, read, createServer, and IP utilities',
    methods: Object.keys(NetFunctions)
};

export default {
    name: 'net',
    functions: NetFunctions,
    functionMetadata: NetFunctionMetadata,
    moduleMetadata: NetModuleMetadata,
    global: false
};
