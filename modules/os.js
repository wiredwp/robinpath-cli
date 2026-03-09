/**
 * Native OS module for RobinPath.
 * Wraps Node.js os module for system information.
 */
import {
    hostname, cpus, totalmem, freemem, networkInterfaces,
    tmpdir, homedir, type, release, uptime, loadavg,
    userInfo, platform, arch, endianness, machine, version as osVersion, EOL
} from 'node:os';

export const OsFunctions = {

    hostname: () => hostname(),

    cpus: () => {
        return cpus().map(cpu => ({
            model: cpu.model,
            speed: cpu.speed,
            times: cpu.times
        }));
    },

    cpuCount: () => cpus().length,

    totalmem: () => totalmem(),

    freemem: () => freemem(),

    usedmem: () => totalmem() - freemem(),

    memoryInfo: () => {
        const total = totalmem();
        const free = freemem();
        return {
            total,
            free,
            used: total - free,
            percentUsed: Math.round((total - free) / total * 10000) / 100
        };
    },

    networkInterfaces: () => {
        const ifaces = networkInterfaces();
        const result = {};
        for (const [name, addrs] of Object.entries(ifaces)) {
            result[name] = addrs.map(addr => ({
                address: addr.address,
                netmask: addr.netmask,
                family: addr.family,
                mac: addr.mac,
                internal: addr.internal,
                cidr: addr.cidr
            }));
        }
        return result;
    },

    tmpdir: () => tmpdir(),

    homedir: () => homedir(),

    type: () => type(),

    release: () => release(),

    uptime: () => uptime(),

    loadavg: () => loadavg(),

    userInfo: () => {
        const info = userInfo();
        return {
            username: info.username,
            uid: info.uid,
            gid: info.gid,
            shell: info.shell,
            homedir: info.homedir
        };
    },

    platform: () => platform(),

    arch: () => arch(),

    endianness: () => endianness(),

    machine: () => {
        if (typeof machine === 'function') return machine();
        return arch();
    },

    version: () => {
        if (typeof osVersion === 'function') return osVersion();
        return release();
    },

    eol: () => EOL
};

export const OsFunctionMetadata = {
    hostname: {
        description: 'Get the operating system hostname',
        parameters: [],
        returnType: 'string', returnDescription: 'Hostname', example: 'os.hostname'
    },
    cpus: {
        description: 'Get CPU information for each core',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of CPU info objects', example: 'os.cpus'
    },
    cpuCount: {
        description: 'Get number of CPU cores',
        parameters: [],
        returnType: 'number', returnDescription: 'Number of CPU cores', example: 'os.cpuCount'
    },
    totalmem: {
        description: 'Get total system memory in bytes',
        parameters: [],
        returnType: 'number', returnDescription: 'Total memory in bytes', example: 'os.totalmem'
    },
    freemem: {
        description: 'Get free system memory in bytes',
        parameters: [],
        returnType: 'number', returnDescription: 'Free memory in bytes', example: 'os.freemem'
    },
    usedmem: {
        description: 'Get used system memory in bytes',
        parameters: [],
        returnType: 'number', returnDescription: 'Used memory in bytes', example: 'os.usedmem'
    },
    memoryInfo: {
        description: 'Get detailed memory info (total, free, used, percentUsed)',
        parameters: [],
        returnType: 'object', returnDescription: 'Memory info object', example: 'os.memoryInfo'
    },
    networkInterfaces: {
        description: 'Get network interface information',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with interface names and address arrays', example: 'os.networkInterfaces'
    },
    tmpdir: {
        description: 'Get the OS temporary directory',
        parameters: [],
        returnType: 'string', returnDescription: 'Temp directory path', example: 'os.tmpdir'
    },
    homedir: {
        description: 'Get the current user home directory',
        parameters: [],
        returnType: 'string', returnDescription: 'Home directory path', example: 'os.homedir'
    },
    type: {
        description: 'Get the operating system name',
        parameters: [],
        returnType: 'string', returnDescription: 'OS name (Linux, Darwin, Windows_NT)', example: 'os.type'
    },
    release: {
        description: 'Get the OS release version',
        parameters: [],
        returnType: 'string', returnDescription: 'Release string', example: 'os.release'
    },
    uptime: {
        description: 'Get system uptime in seconds',
        parameters: [],
        returnType: 'number', returnDescription: 'Uptime in seconds', example: 'os.uptime'
    },
    loadavg: {
        description: 'Get load averages (1, 5, 15 minute)',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of 3 load average numbers', example: 'os.loadavg'
    },
    userInfo: {
        description: 'Get current user information',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with username, uid, gid, shell, homedir', example: 'os.userInfo'
    },
    platform: {
        description: 'Get the operating system platform',
        parameters: [],
        returnType: 'string', returnDescription: 'Platform (win32, darwin, linux)', example: 'os.platform'
    },
    arch: {
        description: 'Get the CPU architecture',
        parameters: [],
        returnType: 'string', returnDescription: 'Architecture (x64, arm64)', example: 'os.arch'
    },
    endianness: {
        description: 'Get CPU endianness',
        parameters: [],
        returnType: 'string', returnDescription: 'BE or LE', example: 'os.endianness'
    },
    machine: {
        description: 'Get the machine type',
        parameters: [],
        returnType: 'string', returnDescription: 'Machine type string', example: 'os.machine'
    },
    version: {
        description: 'Get the OS version string',
        parameters: [],
        returnType: 'string', returnDescription: 'OS version', example: 'os.version'
    },
    eol: {
        description: 'Get the platform-specific end-of-line marker',
        parameters: [],
        returnType: 'string', returnDescription: 'EOL string (\\n or \\r\\n)', example: 'os.eol'
    }
};

export const OsModuleMetadata = {
    description: 'Operating system information: hostname, CPUs, memory, network, platform, and more',
    methods: Object.keys(OsFunctions)
};

export default {
    name: 'os',
    functions: OsFunctions,
    functionMetadata: OsFunctionMetadata,
    moduleMetadata: OsModuleMetadata,
    global: false
};
