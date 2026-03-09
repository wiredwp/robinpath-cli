/**
 * Native assert module for RobinPath.
 * Testing assertions with clear error messages.
 */
import { toStr, requireArgs } from './_helpers.js';

function fail(message) {
    const err = new Error(message);
    err.__formattedMessage = message;
    throw err;
}

export const AssertFunctions = {

    ok: (args) => {
        requireArgs('assert.ok', args, 1);
        const val = args[0];
        const msg = args[1] ? toStr(args[1]) : `Expected truthy, got ${JSON.stringify(val)}`;
        if (!val) fail(msg);
        return true;
    },

    equal: (args) => {
        requireArgs('assert.equal', args, 2);
        const actual = args[0];
        const expected = args[1];
        const msg = args[2] ? toStr(args[2]) : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        if (actual != expected) fail(msg);
        return true;
    },

    strictEqual: (args) => {
        requireArgs('assert.strictEqual', args, 2);
        const actual = args[0];
        const expected = args[1];
        const msg = args[2] ? toStr(args[2]) : `Expected strict ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        if (actual !== expected) fail(msg);
        return true;
    },

    notEqual: (args) => {
        requireArgs('assert.notEqual', args, 2);
        const actual = args[0];
        const expected = args[1];
        const msg = args[2] ? toStr(args[2]) : `Expected not equal to ${JSON.stringify(expected)}`;
        if (actual == expected) fail(msg);
        return true;
    },

    deepEqual: (args) => {
        requireArgs('assert.deepEqual', args, 2);
        const actual = args[0];
        const expected = args[1];
        const msg = args[2] ? toStr(args[2]) : `Deep equal assertion failed`;
        try {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(msg);
        } catch {
            fail(msg);
        }
        return true;
    },

    notDeepEqual: (args) => {
        requireArgs('assert.notDeepEqual', args, 2);
        const msg = args[2] ? toStr(args[2]) : `Expected objects to not be deeply equal`;
        try {
            if (JSON.stringify(args[0]) === JSON.stringify(args[1])) fail(msg);
        } catch {
            return true;
        }
        return true;
    },

    truthy: (args) => {
        requireArgs('assert.truthy', args, 1);
        const msg = args[1] ? toStr(args[1]) : `Expected truthy, got ${JSON.stringify(args[0])}`;
        if (!args[0]) fail(msg);
        return true;
    },

    falsy: (args) => {
        requireArgs('assert.falsy', args, 1);
        const msg = args[1] ? toStr(args[1]) : `Expected falsy, got ${JSON.stringify(args[0])}`;
        if (args[0]) fail(msg);
        return true;
    },

    isNull: (args) => {
        requireArgs('assert.isNull', args, 1);
        const msg = args[1] ? toStr(args[1]) : `Expected null, got ${JSON.stringify(args[0])}`;
        if (args[0] !== null) fail(msg);
        return true;
    },

    isNotNull: (args) => {
        requireArgs('assert.isNotNull', args, 1);
        const msg = args[1] ? toStr(args[1]) : `Expected non-null value`;
        if (args[0] === null) fail(msg);
        return true;
    },

    isType: (args) => {
        requireArgs('assert.isType', args, 2);
        const val = args[0];
        const expectedType = toStr(args[1]);
        const actualType = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
        const msg = args[2] ? toStr(args[2]) : `Expected type ${expectedType}, got ${actualType}`;
        if (actualType !== expectedType) fail(msg);
        return true;
    },

    contains: (args) => {
        requireArgs('assert.contains', args, 2);
        const haystack = args[0];
        const needle = args[1];
        const msg = args[2] ? toStr(args[2]) : `Expected to contain ${JSON.stringify(needle)}`;
        if (typeof haystack === 'string') {
            if (!haystack.includes(toStr(needle))) fail(msg);
        } else if (Array.isArray(haystack)) {
            if (!haystack.includes(needle)) fail(msg);
        } else {
            fail(`assert.contains: first argument must be string or array`);
        }
        return true;
    },

    notContains: (args) => {
        requireArgs('assert.notContains', args, 2);
        const haystack = args[0];
        const needle = args[1];
        const msg = args[2] ? toStr(args[2]) : `Expected to not contain ${JSON.stringify(needle)}`;
        if (typeof haystack === 'string') {
            if (haystack.includes(toStr(needle))) fail(msg);
        } else if (Array.isArray(haystack)) {
            if (haystack.includes(needle)) fail(msg);
        }
        return true;
    },

    match: (args) => {
        requireArgs('assert.match', args, 2);
        const str = toStr(args[0]);
        const pattern = toStr(args[1]);
        const msg = args[2] ? toStr(args[2]) : `Expected "${str}" to match ${pattern}`;
        if (!new RegExp(pattern).test(str)) fail(msg);
        return true;
    },

    notMatch: (args) => {
        requireArgs('assert.notMatch', args, 2);
        const str = toStr(args[0]);
        const pattern = toStr(args[1]);
        const msg = args[2] ? toStr(args[2]) : `Expected "${str}" to not match ${pattern}`;
        if (new RegExp(pattern).test(str)) fail(msg);
        return true;
    },

    greaterThan: (args) => {
        requireArgs('assert.greaterThan', args, 2);
        const a = Number(args[0]);
        const b = Number(args[1]);
        const msg = args[2] ? toStr(args[2]) : `Expected ${a} > ${b}`;
        if (!(a > b)) fail(msg);
        return true;
    },

    lessThan: (args) => {
        requireArgs('assert.lessThan', args, 2);
        const a = Number(args[0]);
        const b = Number(args[1]);
        const msg = args[2] ? toStr(args[2]) : `Expected ${a} < ${b}`;
        if (!(a < b)) fail(msg);
        return true;
    },

    between: (args) => {
        requireArgs('assert.between', args, 3);
        const val = Number(args[0]);
        const min = Number(args[1]);
        const max = Number(args[2]);
        const msg = args[3] ? toStr(args[3]) : `Expected ${val} between ${min} and ${max}`;
        if (val < min || val > max) fail(msg);
        return true;
    },

    lengthOf: (args) => {
        requireArgs('assert.lengthOf', args, 2);
        const val = args[0];
        const expected = Number(args[1]);
        const actual = (typeof val === 'string' || Array.isArray(val)) ? val.length : Object.keys(val).length;
        const msg = args[2] ? toStr(args[2]) : `Expected length ${expected}, got ${actual}`;
        if (actual !== expected) fail(msg);
        return true;
    },

    hasProperty: (args) => {
        requireArgs('assert.hasProperty', args, 2);
        const obj = args[0];
        const prop = toStr(args[1]);
        const msg = args[2] ? toStr(args[2]) : `Expected object to have property "${prop}"`;
        if (typeof obj !== 'object' || obj === null || !(prop in obj)) fail(msg);
        return true;
    },

    throws: async (args, callback) => {
        const msg = args[0] ? toStr(args[0]) : 'Expected an error to be thrown';
        if (!callback) fail('assert.throws requires a callback block');
        try {
            await callback([]);
            fail(msg);
        } catch {
            return true;
        }
    },

    doesNotThrow: async (args, callback) => {
        const msg = args[0] ? toStr(args[0]) : 'Expected no error to be thrown';
        if (!callback) fail('assert.doesNotThrow requires a callback block');
        try {
            await callback([]);
            return true;
        } catch (err) {
            fail(`${msg}: ${err.message}`);
        }
    },

    fail: (args) => {
        const msg = args[0] ? toStr(args[0]) : 'Assertion failed';
        fail(msg);
    }
};

export const AssertFunctionMetadata = {
    ok: { description: 'Assert value is truthy', parameters: [{ name: 'value', dataType: 'any', description: 'Value to check', formInputType: 'json', required: true }, { name: 'message', dataType: 'string', description: 'Error message', formInputType: 'text', required: false }], returnType: 'boolean', returnDescription: 'true if passes', example: 'assert.ok $val' },
    equal: { description: 'Assert loose equality (==)', parameters: [{ name: 'actual', dataType: 'any', description: 'Actual value', formInputType: 'json', required: true }, { name: 'expected', dataType: 'any', description: 'Expected value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if equal', example: 'assert.equal $a $b' },
    strictEqual: { description: 'Assert strict equality (===)', parameters: [{ name: 'actual', dataType: 'any', description: 'Actual', formInputType: 'json', required: true }, { name: 'expected', dataType: 'any', description: 'Expected', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if strict equal', example: 'assert.strictEqual $a $b' },
    notEqual: { description: 'Assert not equal', parameters: [{ name: 'actual', dataType: 'any', description: 'Actual', formInputType: 'json', required: true }, { name: 'expected', dataType: 'any', description: 'Not expected', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if not equal', example: 'assert.notEqual $a $b' },
    deepEqual: { description: 'Assert deep equality', parameters: [{ name: 'actual', dataType: 'any', description: 'Actual', formInputType: 'json', required: true }, { name: 'expected', dataType: 'any', description: 'Expected', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if deeply equal', example: 'assert.deepEqual $a $b' },
    truthy: { description: 'Assert truthy', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true', example: 'assert.truthy $val' },
    falsy: { description: 'Assert falsy', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true', example: 'assert.falsy $val' },
    isNull: { description: 'Assert null', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if null', example: 'assert.isNull $val' },
    isNotNull: { description: 'Assert not null', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if not null', example: 'assert.isNotNull $val' },
    isType: { description: 'Assert value type', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }, { name: 'type', dataType: 'string', description: 'Expected type', formInputType: 'text', required: true }], returnType: 'boolean', returnDescription: 'true if type matches', example: 'assert.isType $val "string"' },
    contains: { description: 'Assert string/array contains value', parameters: [{ name: 'haystack', dataType: 'any', description: 'String or array', formInputType: 'json', required: true }, { name: 'needle', dataType: 'any', description: 'Value to find', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if contains', example: 'assert.contains "hello world" "world"' },
    match: { description: 'Assert string matches regex', parameters: [{ name: 'string', dataType: 'string', description: 'String to test', formInputType: 'text', required: true }, { name: 'pattern', dataType: 'string', description: 'Regex pattern', formInputType: 'text', required: true }], returnType: 'boolean', returnDescription: 'true if matches', example: 'assert.match "hello" "^he"' },
    greaterThan: { description: 'Assert a > b', parameters: [{ name: 'a', dataType: 'number', description: 'Value', formInputType: 'number', required: true }, { name: 'b', dataType: 'number', description: 'Comparison', formInputType: 'number', required: true }], returnType: 'boolean', returnDescription: 'true if a > b', example: 'assert.greaterThan 5 3' },
    lessThan: { description: 'Assert a < b', parameters: [{ name: 'a', dataType: 'number', description: 'Value', formInputType: 'number', required: true }, { name: 'b', dataType: 'number', description: 'Comparison', formInputType: 'number', required: true }], returnType: 'boolean', returnDescription: 'true if a < b', example: 'assert.lessThan 3 5' },
    between: { description: 'Assert value is between min and max', parameters: [{ name: 'value', dataType: 'number', description: 'Value', formInputType: 'number', required: true }, { name: 'min', dataType: 'number', description: 'Minimum', formInputType: 'number', required: true }, { name: 'max', dataType: 'number', description: 'Maximum', formInputType: 'number', required: true }], returnType: 'boolean', returnDescription: 'true if in range', example: 'assert.between 5 1 10' },
    lengthOf: { description: 'Assert length of string/array/object', parameters: [{ name: 'value', dataType: 'any', description: 'Value', formInputType: 'json', required: true }, { name: 'length', dataType: 'number', description: 'Expected length', formInputType: 'number', required: true }], returnType: 'boolean', returnDescription: 'true if length matches', example: 'assert.lengthOf [1,2,3] 3' },
    hasProperty: { description: 'Assert object has a property', parameters: [{ name: 'object', dataType: 'object', description: 'Object', formInputType: 'json', required: true }, { name: 'property', dataType: 'string', description: 'Property name', formInputType: 'text', required: true }], returnType: 'boolean', returnDescription: 'true if has property', example: 'assert.hasProperty $obj "name"' },
    notDeepEqual: { description: 'Assert not deeply equal', parameters: [{ name: 'actual', dataType: 'any', description: 'Actual', formInputType: 'json', required: true }, { name: 'expected', dataType: 'any', description: 'Not expected', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if not deeply equal', example: 'assert.notDeepEqual $a $b' },
    notContains: { description: 'Assert string/array does not contain value', parameters: [{ name: 'haystack', dataType: 'any', description: 'String or array', formInputType: 'json', required: true }, { name: 'needle', dataType: 'any', description: 'Value to check absence', formInputType: 'json', required: true }], returnType: 'boolean', returnDescription: 'true if not contains', example: 'assert.notContains "hello" "xyz"' },
    notMatch: { description: 'Assert string does not match regex', parameters: [{ name: 'string', dataType: 'string', description: 'String to test', formInputType: 'text', required: true }, { name: 'pattern', dataType: 'string', description: 'Regex pattern', formInputType: 'text', required: true }], returnType: 'boolean', returnDescription: 'true if not matches', example: 'assert.notMatch "hello" "^xyz"' },
    throws: { description: 'Assert callback throws an error', parameters: [{ name: 'message', dataType: 'string', description: 'Error message if no throw', formInputType: 'text', required: false }], returnType: 'boolean', returnDescription: 'true if threw', example: 'assert.throws "Should error"' },
    doesNotThrow: { description: 'Assert callback does not throw', parameters: [{ name: 'message', dataType: 'string', description: 'Error message if throws', formInputType: 'text', required: false }], returnType: 'boolean', returnDescription: 'true if no throw', example: 'assert.doesNotThrow "Should not error"' },
    fail: { description: 'Force assertion failure', parameters: [{ name: 'message', dataType: 'string', description: 'Failure message', formInputType: 'text', required: false }], returnType: 'null', returnDescription: 'Always throws', example: 'assert.fail "Not implemented"' }
};

export const AssertModuleMetadata = {
    description: 'Assertions: equal, deepEqual, truthy, falsy, contains, match, greaterThan, throws, and more',
    methods: Object.keys(AssertFunctions)
};

export default {
    name: 'assert',
    functions: AssertFunctions,
    functionMetadata: AssertFunctionMetadata,
    moduleMetadata: AssertModuleMetadata,
    global: false
};
