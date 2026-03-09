/**
 * Native child process module for RobinPath.
 * Execute system commands and spawn processes.
 */
import { exec as _exec, execSync as _execSync, spawn as _spawn } from 'node:child_process';
import { toStr, toNum, requireArgs } from './_helpers.js';

const _processes = new Map();
let _nextId = 1;

export const ChildFunctions = {

    exec: (args) => {
        requireArgs('child.exec', args, 1);
        const command = toStr(args[0]);
        const opts = {};
        if (args[1] && typeof args[1] === 'object') {
            if (args[1].cwd) opts.cwd = toStr(args[1].cwd);
            if (args[1].timeout) opts.timeout = toNum(args[1].timeout);
            if (args[1].encoding) opts.encoding = toStr(args[1].encoding);
            if (args[1].env) opts.env = { ...process.env, ...args[1].env };
            if (args[1].maxBuffer) opts.maxBuffer = toNum(args[1].maxBuffer);
            if (args[1].shell) opts.shell = toStr(args[1].shell);
        }
        opts.encoding = opts.encoding || 'utf-8';

        return new Promise((resolve, reject) => {
            _exec(command, opts, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    code: error ? error.code ?? 1 : 0,
                    error: error ? error.message : null
                });
            });
        });
    },

    execSync: (args) => {
        requireArgs('child.execSync', args, 1);
        const command = toStr(args[0]);
        const opts = { encoding: 'utf-8' };
        if (args[1] && typeof args[1] === 'object') {
            if (args[1].cwd) opts.cwd = toStr(args[1].cwd);
            if (args[1].timeout) opts.timeout = toNum(args[1].timeout);
            if (args[1].shell) opts.shell = toStr(args[1].shell);
        }
        try {
            return _execSync(command, opts);
        } catch (err) {
            return {
                stdout: err.stdout || '',
                stderr: err.stderr || '',
                code: err.status ?? 1,
                error: err.message
            };
        }
    },

    spawn: (args) => {
        requireArgs('child.spawn', args, 1);
        const command = toStr(args[0]);
        const spawnArgs = Array.isArray(args[1]) ? args[1].map(a => toStr(a)) : [];
        const opts = { shell: true };
        if (args[2] && typeof args[2] === 'object') {
            if (args[2].cwd) opts.cwd = toStr(args[2].cwd);
            if (args[2].env) opts.env = { ...process.env, ...args[2].env };
            if (args[2].shell !== undefined) opts.shell = args[2].shell;
            if (args[2].detached) opts.detached = true;
        }

        const child = _spawn(command, spawnArgs, opts);
        const id = `proc_${_nextId++}`;
        let stdout = '';
        let stderr = '';

        if (child.stdout) child.stdout.on('data', (d) => { stdout += d; });
        if (child.stderr) child.stderr.on('data', (d) => { stderr += d; });

        const resultPromise = new Promise((resolve) => {
            child.on('close', (code) => {
                _processes.delete(id);
                resolve({ id, stdout, stderr, code: code ?? 0 });
            });
            child.on('error', (err) => {
                _processes.delete(id);
                resolve({ id, stdout, stderr, code: 1, error: err.message });
            });
        });

        _processes.set(id, { child, resultPromise });
        return id;
    },

    wait: async (args) => {
        requireArgs('child.wait', args, 1);
        const id = toStr(args[0]);
        const proc = _processes.get(id);
        if (!proc) return { error: `Process ${id} not found` };
        return await proc.resultPromise;
    },

    kill: (args) => {
        requireArgs('child.kill', args, 1);
        const id = toStr(args[0]);
        const signal = toStr(args[1], 'SIGTERM');
        const proc = _processes.get(id);
        if (!proc) return false;
        proc.child.kill(signal);
        _processes.delete(id);
        return true;
    },

    running: () => {
        return Array.from(_processes.keys());
    }
};

export const ChildFunctionMetadata = {
    exec: {
        description: 'Execute a shell command and return output',
        parameters: [
            { name: 'command', dataType: 'string', description: 'Shell command to execute', formInputType: 'text', required: true },
            { name: 'options', dataType: 'object', description: 'Options: cwd, timeout, encoding, env, maxBuffer, shell', formInputType: 'json', required: false }
        ],
        returnType: 'object', returnDescription: 'Object with stdout, stderr, code, error', example: 'child.exec "ls -la"'
    },
    execSync: {
        description: 'Execute a shell command synchronously',
        parameters: [
            { name: 'command', dataType: 'string', description: 'Shell command', formInputType: 'text', required: true },
            { name: 'options', dataType: 'object', description: 'Options: cwd, timeout, shell', formInputType: 'json', required: false }
        ],
        returnType: 'string', returnDescription: 'Command output string', example: 'child.execSync "echo hello"'
    },
    spawn: {
        description: 'Spawn a child process (non-blocking)',
        parameters: [
            { name: 'command', dataType: 'string', description: 'Command to run', formInputType: 'text', required: true },
            { name: 'args', dataType: 'array', description: 'Command arguments', formInputType: 'json', required: false },
            { name: 'options', dataType: 'object', description: 'Options: cwd, env, shell, detached', formInputType: 'json', required: false }
        ],
        returnType: 'string', returnDescription: 'Process handle ID', example: 'child.spawn "node" ["server.js"]'
    },
    wait: {
        description: 'Wait for a spawned process to finish',
        parameters: [{ name: 'processId', dataType: 'string', description: 'Process handle ID from spawn', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Object with stdout, stderr, code', example: 'child.wait $pid'
    },
    kill: {
        description: 'Kill a spawned process',
        parameters: [
            { name: 'processId', dataType: 'string', description: 'Process handle ID', formInputType: 'text', required: true },
            { name: 'signal', dataType: 'string', description: 'Signal (default: SIGTERM)', formInputType: 'text', required: false, defaultValue: 'SIGTERM' }
        ],
        returnType: 'boolean', returnDescription: 'true if killed', example: 'child.kill $pid'
    },
    running: {
        description: 'List all running spawned processes',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of process handle IDs', example: 'child.running'
    }
};

export const ChildModuleMetadata = {
    description: 'Child process execution: exec, execSync, spawn, kill, and process management',
    methods: Object.keys(ChildFunctions)
};

export default {
    name: 'child',
    functions: ChildFunctions,
    functionMetadata: ChildFunctionMetadata,
    moduleMetadata: ChildModuleMetadata,
    global: false
};
