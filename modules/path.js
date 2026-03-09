/**
 * Native path module for RobinPath.
 * Wraps Node.js path operations.
 */
import { join, resolve, dirname, basename, extname, parse, format, relative, normalize, isAbsolute, sep, delimiter, posix, win32 } from 'node:path';
import { toStr, requireArgs } from './_helpers.js';

export const PathFunctions = {

    join: (args) => {
        return join(...args.map(a => toStr(a)));
    },

    resolve: (args) => {
        return resolve(...args.map(a => toStr(a)));
    },

    dirname: (args) => {
        requireArgs('path.dirname', args, 1);
        return dirname(toStr(args[0]));
    },

    basename: (args) => {
        requireArgs('path.basename', args, 1);
        const ext = args[1] != null ? toStr(args[1]) : undefined;
        return basename(toStr(args[0]), ext);
    },

    extname: (args) => {
        requireArgs('path.extname', args, 1);
        return extname(toStr(args[0]));
    },

    parse: (args) => {
        requireArgs('path.parse', args, 1);
        return parse(toStr(args[0]));
    },

    format: (args) => {
        requireArgs('path.format', args, 1);
        const obj = args[0];
        if (typeof obj !== 'object' || obj === null) {
            throw new Error('path.format requires an object with root/dir/base/name/ext');
        }
        return format(obj);
    },

    relative: (args) => {
        requireArgs('path.relative', args, 2);
        return relative(toStr(args[0]), toStr(args[1]));
    },

    normalize: (args) => {
        requireArgs('path.normalize', args, 1);
        return normalize(toStr(args[0]));
    },

    isAbsolute: (args) => {
        requireArgs('path.isAbsolute', args, 1);
        return isAbsolute(toStr(args[0]));
    },

    sep: () => sep,

    delimiter: () => delimiter,

    toNamespacedPath: (args) => {
        requireArgs('path.toNamespacedPath', args, 1);
        // On Windows, converts to \\?\ prefix; on POSIX, returns unchanged
        if (process.platform === 'win32') {
            return '\\\\?\\' + resolve(toStr(args[0]));
        }
        return resolve(toStr(args[0]));
    }
};

export const PathFunctionMetadata = {
    join: {
        description: 'Join path segments together',
        parameters: [{ name: 'segments', dataType: 'string', description: 'Path segments', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Joined path', example: 'path.join "src" "modules" "test.js"'
    },
    resolve: {
        description: 'Resolve path segments to an absolute path',
        parameters: [{ name: 'segments', dataType: 'string', description: 'Path segments', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Absolute path', example: 'path.resolve "src" "file.js"'
    },
    dirname: {
        description: 'Get directory name of a path',
        parameters: [{ name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Directory name', example: 'path.dirname "/home/user/file.txt"'
    },
    basename: {
        description: 'Get the last portion of a path',
        parameters: [
            { name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true },
            { name: 'ext', dataType: 'string', description: 'Extension to strip', formInputType: 'text', required: false }
        ],
        returnType: 'string', returnDescription: 'Base name', example: 'path.basename "/home/user/file.txt"'
    },
    extname: {
        description: 'Get file extension',
        parameters: [{ name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Extension (e.g. ".txt")', example: 'path.extname "file.txt"'
    },
    parse: {
        description: 'Parse a path into components',
        parameters: [{ name: 'path', dataType: 'string', description: 'File path', formInputType: 'text', required: true }],
        returnType: 'object', returnDescription: 'Object with root, dir, base, name, ext', example: 'path.parse "/home/user/file.txt"'
    },
    format: {
        description: 'Format a path object into a string',
        parameters: [{ name: 'pathObject', dataType: 'object', description: 'Object with root/dir/base/name/ext', formInputType: 'json', required: true }],
        returnType: 'string', returnDescription: 'Formatted path string', example: 'path.format $obj'
    },
    relative: {
        description: 'Get relative path from one path to another',
        parameters: [
            { name: 'from', dataType: 'string', description: 'Base path', formInputType: 'text', required: true },
            { name: 'to', dataType: 'string', description: 'Target path', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Relative path', example: 'path.relative "/home" "/home/user/file.txt"'
    },
    normalize: {
        description: 'Normalize a path (resolve . and ..)',
        parameters: [{ name: 'path', dataType: 'string', description: 'Path to normalize', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Normalized path', example: 'path.normalize "/home/user/../file.txt"'
    },
    isAbsolute: {
        description: 'Check if a path is absolute',
        parameters: [{ name: 'path', dataType: 'string', description: 'Path to check', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if absolute', example: 'path.isAbsolute "/home/user"'
    },
    sep: {
        description: 'Get the platform-specific path separator',
        parameters: [],
        returnType: 'string', returnDescription: 'Path separator (/ or \\)', example: 'path.sep'
    },
    delimiter: {
        description: 'Get the platform-specific path delimiter',
        parameters: [],
        returnType: 'string', returnDescription: 'Path delimiter (: or ;)', example: 'path.delimiter'
    },
    toNamespacedPath: {
        description: 'Convert to namespaced path (Windows \\\\?\\ prefix)',
        parameters: [{ name: 'path', dataType: 'string', description: 'Path to convert', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Namespaced path', example: 'path.toNamespacedPath "C:\\Users"'
    }
};

export const PathModuleMetadata = {
    description: 'Path manipulation: join, resolve, parse, format, and platform-aware utilities',
    methods: Object.keys(PathFunctions)
};

export default {
    name: 'path',
    functions: PathFunctions,
    functionMetadata: PathFunctionMetadata,
    moduleMetadata: PathModuleMetadata,
    global: false
};
