/**
 * Native DNS module for RobinPath.
 * DNS resolution and lookup.
 */
import { promises as dns } from 'node:dns';
import { toStr, requireArgs } from './_helpers.js';

export const DnsFunctions = {

    lookup: async (args) => {
        requireArgs('dns.lookup', args, 1);
        const hostname = toStr(args[0]);
        const result = await dns.lookup(hostname, { all: true });
        if (Array.isArray(result)) {
            return result.map(r => ({ address: r.address, family: r.family }));
        }
        return { address: result.address, family: result.family };
    },

    resolve: async (args) => {
        requireArgs('dns.resolve', args, 1);
        const hostname = toStr(args[0]);
        const rrtype = toStr(args[1], 'A');
        return await dns.resolve(hostname, rrtype);
    },

    resolve4: async (args) => {
        requireArgs('dns.resolve4', args, 1);
        return await dns.resolve4(toStr(args[0]));
    },

    resolve6: async (args) => {
        requireArgs('dns.resolve6', args, 1);
        return await dns.resolve6(toStr(args[0]));
    },

    resolveMx: async (args) => {
        requireArgs('dns.resolveMx', args, 1);
        return await dns.resolveMx(toStr(args[0]));
    },

    resolveTxt: async (args) => {
        requireArgs('dns.resolveTxt', args, 1);
        const records = await dns.resolveTxt(toStr(args[0]));
        return records.map(r => r.join(''));
    },

    resolveNs: async (args) => {
        requireArgs('dns.resolveNs', args, 1);
        return await dns.resolveNs(toStr(args[0]));
    },

    resolveCname: async (args) => {
        requireArgs('dns.resolveCname', args, 1);
        return await dns.resolveCname(toStr(args[0]));
    },

    resolveSrv: async (args) => {
        requireArgs('dns.resolveSrv', args, 1);
        return await dns.resolveSrv(toStr(args[0]));
    },

    resolveSoa: async (args) => {
        requireArgs('dns.resolveSoa', args, 1);
        return await dns.resolveSoa(toStr(args[0]));
    },

    reverse: async (args) => {
        requireArgs('dns.reverse', args, 1);
        return await dns.reverse(toStr(args[0]));
    }
};

export const DnsFunctionMetadata = {
    lookup: {
        description: 'Resolve hostname to IP address(es)',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Hostname to resolve', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of {address, family}', example: 'dns.lookup "google.com"'
    },
    resolve: {
        description: 'Resolve DNS records by type',
        parameters: [
            { name: 'hostname', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true },
            { name: 'rrtype', dataType: 'string', description: 'Record type (A, AAAA, MX, TXT, etc.)', formInputType: 'text', required: false, defaultValue: 'A' }
        ],
        returnType: 'array', returnDescription: 'Array of DNS records', example: 'dns.resolve "example.com" "MX"'
    },
    resolve4: {
        description: 'Resolve IPv4 addresses',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of IPv4 addresses', example: 'dns.resolve4 "google.com"'
    },
    resolve6: {
        description: 'Resolve IPv6 addresses',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of IPv6 addresses', example: 'dns.resolve6 "google.com"'
    },
    resolveMx: {
        description: 'Resolve MX (mail) records',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Domain', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of {exchange, priority}', example: 'dns.resolveMx "gmail.com"'
    },
    resolveTxt: {
        description: 'Resolve TXT records',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Domain', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of TXT record strings', example: 'dns.resolveTxt "example.com"'
    },
    resolveNs: {
        description: 'Resolve NS (nameserver) records',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Domain', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of nameserver hostnames', example: 'dns.resolveNs "example.com"'
    },
    resolveCname: {
        description: 'Resolve CNAME records',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of CNAME records', example: 'dns.resolveCname "www.example.com"'
    },
    resolveSrv: {
        description: 'Resolve SRV records',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Hostname', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of SRV records', example: 'dns.resolveSrv "_http._tcp.example.com"'
    },
    resolveSoa: {
        description: 'Resolve SOA (Start of Authority) record',
        parameters: [{ name: 'hostname', dataType: 'string', description: 'Domain', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'SOA record object', example: 'dns.resolveSoa "example.com"'
    },
    reverse: {
        description: 'Reverse DNS lookup (IP to hostname)',
        parameters: [{ name: 'ip', dataType: 'string', description: 'IP address', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of hostnames', example: 'dns.reverse "8.8.8.8"'
    }
};

export const DnsModuleMetadata = {
    description: 'DNS resolution: lookup, resolve A/AAAA/MX/TXT/NS/SRV/SOA records, reverse lookup',
    methods: Object.keys(DnsFunctions)
};

export default {
    name: 'dns',
    functions: DnsFunctions,
    functionMetadata: DnsFunctionMetadata,
    moduleMetadata: DnsModuleMetadata,
    global: false
};
