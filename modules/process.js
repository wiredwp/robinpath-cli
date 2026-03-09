/**
 * Native process module for RobinPath.
 * Exposes Node.js process information and control.
 */
import { toStr, toNum } from './_helpers.js';

export const ProcessFunctions = {

    env: (args) => {
        if (args.length === 0) return { ...process.env };
        const key = toStr(args[0]);
        if (args.length >= 2) {
            // Set environment variable
            process.env[key] = toStr(args[1]);
            return true;
        }
        return process.env[key] ?? null;
    },

    argv: () => {
        return process.argv.slice(2);
    },

    exit: (args) => {
        const code = args.length > 0 ? toNum(args[0], 0) : 0;
        process.exit(code);
    },

    cwd: () => {
        return process.cwd();
    },

    chdir: (args) => {
        if (args.length < 1) throw new Error('process.chdir requires a directory path');
        process.chdir(toStr(args[0]));
        return process.cwd();
    },

    pid: () => {
        return process.pid;
    },

    ppid: () => {
        return process.ppid;
    },

    platform: () => {
        return process.platform;
    },

    arch: () => {
        return process.arch;
    },

    version: () => {
        return process.version;
    },

    versions: () => {
        return { ...process.versions };
    },

    memoryUsage: () => {
        const mem = process.memoryUsage();
        return {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers
        };
    },

    uptime: () => {
        return process.uptime();
    },

    hrtime: () => {
        const [s, ns] = process.hrtime();
        return s * 1e9 + ns;
    },

    title: (args) => {
        if (args.length > 0) {
            process.title = toStr(args[0]);
        }
        return process.title;
    },

    execPath: () => {
        return process.execPath;
    },

    cpuUsage: () => {
        const usage = process.cpuUsage();
        return { user: usage.user, system: usage.system };
    },

    resourceUsage: () => {
        if (typeof process.resourceUsage === 'function') {
            return process.resourceUsage();
        }
        return null;
    }
};

export const ProcessFunctionMetadata = {
    env: {
        description: 'Get or set environment variables',
        parameters: [
            { name: 'key', dataType: 'string', description: 'Variable name (omit to get all)', formInputType: 'text', required: false },
            { name: 'value', dataType: 'string', description: 'Value to set (omit to get)', formInputType: 'text', required: false }
        ],
        returnType: 'any', returnDescription: 'Variable value, all variables, or true on set', example: 'process.env "PATH"'
    },
    argv: {
        description: 'Get command-line arguments',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of argument strings', example: 'process.argv'
    },
    exit: {
        description: 'Exit the process with a code',
        parameters: [{ name: 'code', dataType: 'number', description: 'Exit code (default: 0)', formInputType: 'number', required: false, defaultValue: 0 }],
        returnType: 'null', returnDescription: 'Does not return', example: 'process.exit 1'
    },
    cwd: {
        description: 'Get current working directory',
        parameters: [],
        returnType: 'string', returnDescription: 'Current working directory', example: 'process.cwd'
    },
    chdir: {
        description: 'Change current working directory',
        parameters: [{ name: 'directory', dataType: 'string', description: 'Directory to change to', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'New working directory', example: 'process.chdir "/home/user"'
    },
    pid: {
        description: 'Get process ID',
        parameters: [],
        returnType: 'number', returnDescription: 'Process ID', example: 'process.pid'
    },
    ppid: {
        description: 'Get parent process ID',
        parameters: [],
        returnType: 'number', returnDescription: 'Parent process ID', example: 'process.ppid'
    },
    platform: {
        description: 'Get operating system platform',
        parameters: [],
        returnType: 'string', returnDescription: 'Platform (win32, darwin, linux)', example: 'process.platform'
    },
    arch: {
        description: 'Get CPU architecture',
        parameters: [],
        returnType: 'string', returnDescription: 'Architecture (x64, arm64, etc.)', example: 'process.arch'
    },
    version: {
        description: 'Get Node.js version',
        parameters: [],
        returnType: 'string', returnDescription: 'Version string', example: 'process.version'
    },
    versions: {
        description: 'Get version strings of Node.js and its dependencies',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with version strings', example: 'process.versions'
    },
    memoryUsage: {
        description: 'Get memory usage statistics',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with rss, heapTotal, heapUsed, external', example: 'process.memoryUsage'
    },
    uptime: {
        description: 'Get process uptime in seconds',
        parameters: [],
        returnType: 'number', returnDescription: 'Uptime in seconds', example: 'process.uptime'
    },
    hrtime: {
        description: 'Get high-resolution time in nanoseconds',
        parameters: [],
        returnType: 'number', returnDescription: 'Time in nanoseconds', example: 'process.hrtime'
    },
    title: {
        description: 'Get or set process title',
        parameters: [{ name: 'title', dataType: 'string', description: 'New title (omit to get)', formInputType: 'text', required: false }],
        returnType: 'string', returnDescription: 'Process title', example: 'process.title "MyApp"'
    },
    execPath: {
        description: 'Get path to the Node.js executable',
        parameters: [],
        returnType: 'string', returnDescription: 'Executable path', example: 'process.execPath'
    },
    cpuUsage: {
        description: 'Get CPU usage (user and system microseconds)',
        parameters: [],
        returnType: 'object', returnDescription: 'Object with user and system CPU time', example: 'process.cpuUsage'
    },
    resourceUsage: {
        description: 'Get resource usage statistics',
        parameters: [],
        returnType: 'object', returnDescription: 'Resource usage object', example: 'process.resourceUsage'
    }
};

export const ProcessModuleMetadata = {
    description: 'Process information and control: env, argv, pid, memory, CPU, and more',
    methods: Object.keys(ProcessFunctions)
};

export default {
    name: 'process',
    functions: ProcessFunctions,
    functionMetadata: ProcessFunctionMetadata,
    moduleMetadata: ProcessModuleMetadata,
    global: false
};
