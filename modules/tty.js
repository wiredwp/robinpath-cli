/**
 * Native tty module for RobinPath.
 * Terminal/TTY detection and capabilities — needed by supports-color, chalk, etc.
 */
import { isatty } from 'node:tty';
import { toNum, requireArgs } from './_helpers.js';

export const TtyFunctions = {

    isatty: (args) => {
        requireArgs('tty.isatty', args, 1);
        const fd = toNum(args[0], 1);
        return isatty(fd);
    },

    isStdinTTY: () => process.stdin?.isTTY === true,

    isStdoutTTY: () => process.stdout?.isTTY === true,

    isStderrTTY: () => process.stderr?.isTTY === true,

    columns: () => process.stdout?.columns || 80,

    rows: () => process.stdout?.rows || 24,

    size: () => ({
        columns: process.stdout?.columns || 80,
        rows: process.stdout?.rows || 24
    }),

    hasColors: (args) => {
        const count = args[0] ? toNum(args[0], 16) : 16;
        if (process.stdout?.hasColors) {
            return process.stdout.hasColors(count);
        }
        // Fallback: detect from env
        const env = process.env;
        if (env.NO_COLOR) return false;
        if (env.FORCE_COLOR) return true;
        if (env.TERM === 'dumb') return false;
        if (process.platform === 'win32') return true;
        if (env.CI) return true;
        if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return count <= 16777216;
        if (env.TERM_PROGRAM === 'iTerm.app') return count <= 256;
        if (/256color/i.test(env.TERM || '')) return count <= 256;
        return count <= 16;
    },

    colorDepth: () => {
        if (process.stdout?.getColorDepth) {
            return process.stdout.getColorDepth();
        }
        const env = process.env;
        if (env.NO_COLOR) return 1;
        if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 24;
        if (process.platform === 'win32') return 4;
        if (/256color/i.test(env.TERM || '')) return 8;
        return 4;
    },

    supportsColor: () => {
        const env = process.env;
        if (env.NO_COLOR) return false;
        if (env.FORCE_COLOR) return true;
        if (env.TERM === 'dumb') return false;
        if (process.platform === 'win32') return true;
        if (process.stdout?.isTTY) return true;
        if (env.CI) return true;
        return false;
    },

    getWindowSize: () => {
        if (process.stdout?.getWindowSize) {
            const [cols, rows] = process.stdout.getWindowSize();
            return { columns: cols, rows };
        }
        return {
            columns: process.stdout?.columns || 80,
            rows: process.stdout?.rows || 24
        };
    },

    clearLine: (args) => {
        const dir = args[0] ? toNum(args[0], 0) : 0;
        if (process.stdout?.clearLine) {
            process.stdout.clearLine(dir);
            return true;
        }
        return false;
    },

    cursorTo: (args) => {
        requireArgs('tty.cursorTo', args, 1);
        const x = toNum(args[0], 0);
        const y = args[1] != null ? toNum(args[1]) : undefined;
        if (process.stdout?.cursorTo) {
            process.stdout.cursorTo(x, y);
            return true;
        }
        return false;
    },

    moveCursor: (args) => {
        requireArgs('tty.moveCursor', args, 2);
        const dx = toNum(args[0], 0);
        const dy = toNum(args[1], 0);
        if (process.stdout?.moveCursor) {
            process.stdout.moveCursor(dx, dy);
            return true;
        }
        return false;
    }
};

export const TtyFunctionMetadata = {
    isatty: {
        description: 'Check if a file descriptor is a TTY',
        parameters: [{ name: 'fd', dataType: 'number', description: 'File descriptor (0=stdin, 1=stdout, 2=stderr)', formInputType: 'number', required: true }],
        returnType: 'boolean', returnDescription: 'true if TTY', example: 'tty.isatty 1'
    },
    isStdinTTY: { description: 'Check if stdin is a TTY', parameters: [], returnType: 'boolean', returnDescription: 'true if TTY', example: 'tty.isStdinTTY' },
    isStdoutTTY: { description: 'Check if stdout is a TTY', parameters: [], returnType: 'boolean', returnDescription: 'true if TTY', example: 'tty.isStdoutTTY' },
    isStderrTTY: { description: 'Check if stderr is a TTY', parameters: [], returnType: 'boolean', returnDescription: 'true if TTY', example: 'tty.isStderrTTY' },
    columns: { description: 'Get terminal width in columns', parameters: [], returnType: 'number', returnDescription: 'Column count', example: 'tty.columns' },
    rows: { description: 'Get terminal height in rows', parameters: [], returnType: 'number', returnDescription: 'Row count', example: 'tty.rows' },
    size: { description: 'Get terminal size {columns, rows}', parameters: [], returnType: 'object', returnDescription: '{columns, rows}', example: 'tty.size' },
    hasColors: {
        description: 'Check if terminal supports N colors',
        parameters: [{ name: 'count', dataType: 'number', description: 'Number of colors to check (default: 16)', formInputType: 'number', required: false, defaultValue: '16' }],
        returnType: 'boolean', returnDescription: 'true if supported', example: 'tty.hasColors 256'
    },
    colorDepth: { description: 'Get terminal color depth in bits', parameters: [], returnType: 'number', returnDescription: 'Color depth (1, 4, 8, or 24)', example: 'tty.colorDepth' },
    supportsColor: { description: 'Check if terminal supports color output', parameters: [], returnType: 'boolean', returnDescription: 'true if color supported', example: 'tty.supportsColor' },
    getWindowSize: { description: 'Get terminal window size', parameters: [], returnType: 'object', returnDescription: '{columns, rows}', example: 'tty.getWindowSize' },
    clearLine: {
        description: 'Clear the current terminal line',
        parameters: [{ name: 'direction', dataType: 'number', description: '-1=left, 0=entire, 1=right', formInputType: 'number', required: false, defaultValue: '0' }],
        returnType: 'boolean', returnDescription: 'true if cleared', example: 'tty.clearLine 0'
    },
    cursorTo: {
        description: 'Move cursor to position',
        parameters: [
            { name: 'x', dataType: 'number', description: 'Column position', formInputType: 'number', required: true },
            { name: 'y', dataType: 'number', description: 'Row position', formInputType: 'number', required: false }
        ],
        returnType: 'boolean', returnDescription: 'true if moved', example: 'tty.cursorTo 0 5'
    },
    moveCursor: {
        description: 'Move cursor relative to current position',
        parameters: [
            { name: 'dx', dataType: 'number', description: 'Horizontal offset', formInputType: 'number', required: true },
            { name: 'dy', dataType: 'number', description: 'Vertical offset', formInputType: 'number', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if moved', example: 'tty.moveCursor 1 -1'
    }
};

export const TtyModuleMetadata = {
    description: 'TTY: terminal detection, color support, cursor control, window size',
    methods: Object.keys(TtyFunctions)
};

export default {
    name: 'tty',
    functions: TtyFunctions,
    functionMetadata: TtyFunctionMetadata,
    moduleMetadata: TtyModuleMetadata,
    global: false
};
