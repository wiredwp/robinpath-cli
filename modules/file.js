/**
 * Native file system module for RobinPath.
 * Provides Node.js-level fs operations.
 */
import { readFile, writeFile, appendFile, rm, cp, rename, readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { toStr, requireArgs } from './_helpers.js';

export const FileFunctions = {

    read: async (args) => {
        requireArgs('file.read', args, 1);
        const filePath = resolve(toStr(args[0]));
        const encoding = toStr(args[1], 'utf-8');
        return await readFile(filePath, { encoding });
    },

    readBinary: async (args) => {
        requireArgs('file.readBinary', args, 1);
        const filePath = resolve(toStr(args[0]));
        const buf = await readFile(filePath);
        return buf.toString('base64');
    },

    write: async (args) => {
        requireArgs('file.write', args, 2);
        const filePath = resolve(toStr(args[0]));
        const content = toStr(args[1]);
        const encoding = toStr(args[2], 'utf-8');
        await writeFile(filePath, content, { encoding });
        return true;
    },

    writeBinary: async (args) => {
        requireArgs('file.writeBinary', args, 2);
        const filePath = resolve(toStr(args[0]));
        const base64Data = toStr(args[1]);
        await writeFile(filePath, Buffer.from(base64Data, 'base64'));
        return true;
    },

    append: async (args) => {
        requireArgs('file.append', args, 2);
        const filePath = resolve(toStr(args[0]));
        const content = toStr(args[1]);
        await appendFile(filePath, content, 'utf-8');
        return true;
    },

    delete: async (args) => {
        requireArgs('file.delete', args, 1);
        const filePath = resolve(toStr(args[0]));
        await rm(filePath, { recursive: true, force: true });
        return true;
    },

    exists: (args) => {
        requireArgs('file.exists', args, 1);
        return existsSync(resolve(toStr(args[0])));
    },

    copy: async (args) => {
        requireArgs('file.copy', args, 2);
        const src = resolve(toStr(args[0]));
        const dest = resolve(toStr(args[1]));
        await cp(src, dest, { recursive: true });
        return true;
    },

    move: async (args) => {
        requireArgs('file.move', args, 2);
        const src = resolve(toStr(args[0]));
        const dest = resolve(toStr(args[1]));
        await rename(src, dest);
        return true;
    },

    rename: async (args) => {
        requireArgs('file.rename', args, 2);
        const src = resolve(toStr(args[0]));
        const dest = resolve(toStr(args[1]));
        await rename(src, dest);
        return true;
    },

    list: async (args) => {
        requireArgs('file.list', args, 1);
        const dirPath = resolve(toStr(args[0]));
        const recursive = args[1] === true || args[1] === 'true';
        const entries = await readdir(dirPath, { withFileTypes: true, recursive });
        return entries.map(e => ({
            name: e.name,
            isFile: e.isFile(),
            isDirectory: e.isDirectory(),
            path: e.parentPath ? join(e.parentPath, e.name) : join(dirPath, e.name)
        }));
    },

    stat: async (args) => {
        requireArgs('file.stat', args, 1);
        const filePath = resolve(toStr(args[0]));
        const s = await stat(filePath);
        return {
            size: s.size,
            isFile: s.isFile(),
            isDirectory: s.isDirectory(),
            isSymlink: s.isSymbolicLink(),
            created: s.birthtime.toISOString(),
            modified: s.mtime.toISOString(),
            accessed: s.atime.toISOString(),
            permissions: s.mode.toString(8)
        };
    },

    mkdir: async (args) => {
        requireArgs('file.mkdir', args, 1);
        const dirPath = resolve(toStr(args[0]));
        await mkdir(dirPath, { recursive: true });
        return true;
    },

    readJSON: async (args) => {
        requireArgs('file.readJSON', args, 1);
        const filePath = resolve(toStr(args[0]));
        const content = await readFile(filePath, 'utf-8');
        return JSON.parse(content);
    },

    writeJSON: async (args) => {
        requireArgs('file.writeJSON', args, 2);
        const filePath = resolve(toStr(args[0]));
        const data = args[1];
        const indent = args[2] != null ? Number(args[2]) : 2;
        await writeFile(filePath, JSON.stringify(data, null, indent) + '\n', 'utf-8');
        return true;
    },

    size: async (args) => {
        requireArgs('file.size', args, 1);
        const filePath = resolve(toStr(args[0]));
        const s = await stat(filePath);
        return s.size;
    },

    isFile: (args) => {
        requireArgs('file.isFile', args, 1);
        const filePath = resolve(toStr(args[0]));
        try { return statSync(filePath).isFile(); } catch { return false; }
    },

    isDir: (args) => {
        requireArgs('file.isDir', args, 1);
        const filePath = resolve(toStr(args[0]));
        try { return statSync(filePath).isDirectory(); } catch { return false; }
    },

    lines: async (args) => {
        requireArgs('file.lines', args, 1);
        const filePath = resolve(toStr(args[0]));
        const content = await readFile(filePath, 'utf-8');
        return content.split(/\r?\n/);
    },

    lineCount: async (args) => {
        requireArgs('file.lineCount', args, 1);
        const filePath = resolve(toStr(args[0]));
        const content = await readFile(filePath, 'utf-8');
        return content.split(/\r?\n/).length;
    },

    temp: (args) => {
        const prefix = toStr(args[0], 'rp_');
        const name = prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        return join(tmpdir(), name);
    },

    cwd: () => {
        return process.cwd();
    }
};

export const FileFunctionMetadata = {
    read: {
        description: 'Read file contents as a string',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path to read', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'string', returnDescription: 'File contents', example: 'file.read "data.txt"'
    },
    readBinary: {
        description: 'Read file as base64-encoded string',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path to read', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Base64-encoded file contents', example: 'file.readBinary "image.png"'
    },
    write: {
        description: 'Write string content to a file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true },
            { name: 'content', dataType: 'string', description: 'Content to write', formInputType: 'textarea', required: true },
            { name: 'encoding', dataType: 'string', description: 'Encoding (default: utf-8)', formInputType: 'text', required: false, defaultValue: 'utf-8' }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.write "out.txt" "Hello"'
    },
    writeBinary: {
        description: 'Write base64 data to a binary file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true },
            { name: 'base64Data', dataType: 'string', description: 'Base64-encoded data', formInputType: 'textarea', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.writeBinary "out.bin" $data'
    },
    append: {
        description: 'Append content to a file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true },
            { name: 'content', dataType: 'string', description: 'Content to append', formInputType: 'textarea', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.append "log.txt" "new line"'
    },
    delete: {
        description: 'Delete a file or directory (recursive)',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to delete', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.delete "temp/"'
    },
    exists: {
        description: 'Check if a file or directory exists',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to check', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if exists', example: 'file.exists "config.json"'
    },
    copy: {
        description: 'Copy a file or directory',
        parameters: [
            { name: 'source', dataType: 'string', description: 'Source path', formInputType: 'text', required: true },
            { name: 'destination', dataType: 'string', description: 'Destination path', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.copy "a.txt" "b.txt"'
    },
    move: {
        description: 'Move/rename a file or directory',
        parameters: [
            { name: 'source', dataType: 'string', description: 'Source path', formInputType: 'text', required: true },
            { name: 'destination', dataType: 'string', description: 'Destination path', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.move "old.txt" "new.txt"'
    },
    rename: {
        description: 'Rename a file or directory',
        parameters: [
            { name: 'source', dataType: 'string', description: 'Current name', formInputType: 'text', required: true },
            { name: 'destination', dataType: 'string', description: 'New name', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.rename "old.txt" "new.txt"'
    },
    list: {
        description: 'List files and directories in a path',
        parameters: [
            { name: 'directory', dataType: 'string', description: 'Directory to list', formInputType: 'text', required: true },
            { name: 'recursive', dataType: 'boolean', description: 'List recursively (default: false)', formInputType: 'checkbox', required: false, defaultValue: false }
        ],
        returnType: 'array', returnDescription: 'Array of {name, isFile, isDirectory, path}', example: 'file.list "src/"'
    },
    stat: {
        description: 'Get file/directory metadata',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to inspect', formInputType: 'text', required: true }
        ],
        returnType: 'object', returnDescription: 'Object with size, isFile, isDirectory, created, modified', example: 'file.stat "data.txt"'
    },
    mkdir: {
        description: 'Create a directory (recursive)',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Directory path', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.mkdir "output/data"'
    },
    readJSON: {
        description: 'Read and parse a JSON file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to JSON file', formInputType: 'text', required: true }
        ],
        returnType: 'object', returnDescription: 'Parsed JSON object', example: 'file.readJSON "config.json"'
    },
    writeJSON: {
        description: 'Write an object as JSON to a file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true },
            { name: 'data', dataType: 'object', description: 'Object to write', formInputType: 'json', required: true },
            { name: 'indent', dataType: 'number', description: 'Indentation (default: 2)', formInputType: 'number', required: false, defaultValue: 2 }
        ],
        returnType: 'boolean', returnDescription: 'true on success', example: 'file.writeJSON "out.json" $data'
    },
    size: {
        description: 'Get file size in bytes',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }
        ],
        returnType: 'number', returnDescription: 'Size in bytes', example: 'file.size "data.bin"'
    },
    isFile: {
        description: 'Check if path is a file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to check', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if file', example: 'file.isFile "data.txt"'
    },
    isDir: {
        description: 'Check if path is a directory',
        parameters: [
            { name: 'path', dataType: 'string', description: 'Path to check', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if directory', example: 'file.isDir "src/"'
    },
    lines: {
        description: 'Read file and split into array of lines',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }
        ],
        returnType: 'array', returnDescription: 'Array of lines', example: 'file.lines "data.txt"'
    },
    lineCount: {
        description: 'Count number of lines in a file',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }
        ],
        returnType: 'number', returnDescription: 'Number of lines', example: 'file.lineCount "data.txt"'
    },
    temp: {
        description: 'Generate a temporary file path',
        parameters: [
            { name: 'prefix', dataType: 'string', description: 'Filename prefix (default: rp_)', formInputType: 'text', required: false, defaultValue: 'rp_' }
        ],
        returnType: 'string', returnDescription: 'Temporary file path', example: 'file.temp "myapp_"'
    },
    cwd: {
        description: 'Get current working directory',
        parameters: [],
        returnType: 'string', returnDescription: 'Current working directory path', example: 'file.cwd'
    }
};

export const FileModuleMetadata = {
    description: 'File system operations: read, write, copy, move, delete, list, and more',
    methods: Object.keys(FileFunctions)
};

export default {
    name: 'file',
    functions: FileFunctions,
    functionMetadata: FileFunctionMetadata,
    moduleMetadata: FileModuleMetadata,
    global: false
};
