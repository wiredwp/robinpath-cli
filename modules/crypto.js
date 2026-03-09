/**
 * Native crypto module for RobinPath.
 * Full cryptographic operations powered by Node.js crypto.
 */
import {
    createHash, createHmac, createCipheriv, createDecipheriv,
    randomBytes, randomUUID, randomInt, pbkdf2 as _pbkdf2, scrypt as _scrypt,
    getCiphers, getHashes
} from 'node:crypto';
import { toStr, toNum, requireArgs } from './_helpers.js';

export const CryptoNativeFunctions = {

    // --- Hashing ---

    hash: async (args) => {
        requireArgs('crypto.hash', args, 2);
        const algo = toStr(args[0]);
        const data = toStr(args[1]);
        const encoding = toStr(args[2], 'hex');
        return createHash(algo).update(data).digest(encoding);
    },

    md5: async (args) => {
        requireArgs('crypto.md5', args, 1);
        return createHash('md5').update(toStr(args[0])).digest('hex');
    },

    sha1: async (args) => {
        requireArgs('crypto.sha1', args, 1);
        return createHash('sha1').update(toStr(args[0])).digest('hex');
    },

    sha256: async (args) => {
        requireArgs('crypto.sha256', args, 1);
        return createHash('sha256').update(toStr(args[0])).digest('hex');
    },

    sha512: async (args) => {
        requireArgs('crypto.sha512', args, 1);
        return createHash('sha512').update(toStr(args[0])).digest('hex');
    },

    // --- HMAC ---

    hmac: async (args) => {
        requireArgs('crypto.hmac', args, 3);
        const algo = toStr(args[0]);
        const key = toStr(args[1]);
        const data = toStr(args[2]);
        const encoding = toStr(args[3], 'hex');
        return createHmac(algo, key).update(data).digest(encoding);
    },

    hmacSha256: async (args) => {
        requireArgs('crypto.hmacSha256', args, 2);
        return createHmac('sha256', toStr(args[0])).update(toStr(args[1])).digest('hex');
    },

    hmacSha512: async (args) => {
        requireArgs('crypto.hmacSha512', args, 2);
        return createHmac('sha512', toStr(args[0])).update(toStr(args[1])).digest('hex');
    },

    // --- Encryption ---

    encrypt: async (args) => {
        requireArgs('crypto.encrypt', args, 3);
        const algo = toStr(args[0], 'aes-256-cbc');
        const key = toStr(args[1]);
        const data = toStr(args[2]);
        // Derive a 32-byte key from the input key
        const keyBuf = createHash('sha256').update(key).digest();
        // Generate random IV
        const iv = randomBytes(16);
        const cipher = createCipheriv(algo, keyBuf, iv);
        let encrypted = cipher.update(data, 'utf-8', 'hex');
        encrypted += cipher.final('hex');
        // Return IV + encrypted data separated by ':'
        return iv.toString('hex') + ':' + encrypted;
    },

    decrypt: async (args) => {
        requireArgs('crypto.decrypt', args, 3);
        const algo = toStr(args[0], 'aes-256-cbc');
        const key = toStr(args[1]);
        const encryptedStr = toStr(args[2]);
        const keyBuf = createHash('sha256').update(key).digest();
        const parts = encryptedStr.split(':');
        if (parts.length !== 2) throw new Error('crypto.decrypt: invalid encrypted data format (expected iv:data)');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = createDecipheriv(algo, keyBuf, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    },

    // --- Random ---

    randomBytes: async (args) => {
        const size = toNum(args[0], 32);
        const encoding = toStr(args[1], 'hex');
        return randomBytes(size).toString(encoding);
    },

    randomUUID: () => randomUUID(),

    randomInt: (args) => {
        const min = args.length >= 2 ? toNum(args[0], 0) : 0;
        const max = args.length >= 2 ? toNum(args[1], 100) : toNum(args[0], 100);
        return randomInt(min, max);
    },

    // --- Key Derivation ---

    pbkdf2: (args) => {
        requireArgs('crypto.pbkdf2', args, 2);
        const password = toStr(args[0]);
        const salt = toStr(args[1], 'salt');
        const iterations = toNum(args[2], 100000);
        const keylen = toNum(args[3], 64);
        const digest = toStr(args[4], 'sha512');
        return new Promise((resolve, reject) => {
            _pbkdf2(password, salt, iterations, keylen, digest, (err, key) => {
                if (err) reject(err);
                else resolve(key.toString('hex'));
            });
        });
    },

    scrypt: (args) => {
        requireArgs('crypto.scrypt', args, 2);
        const password = toStr(args[0]);
        const salt = toStr(args[1]);
        const keylen = toNum(args[2], 64);
        return new Promise((resolve, reject) => {
            _scrypt(password, salt, keylen, (err, key) => {
                if (err) reject(err);
                else resolve(key.toString('hex'));
            });
        });
    },

    // --- Encoding ---

    base64Encode: (args) => {
        requireArgs('crypto.base64Encode', args, 1);
        return Buffer.from(toStr(args[0])).toString('base64');
    },

    base64Decode: (args) => {
        requireArgs('crypto.base64Decode', args, 1);
        return Buffer.from(toStr(args[0]), 'base64').toString('utf-8');
    },

    base64UrlEncode: (args) => {
        requireArgs('crypto.base64UrlEncode', args, 1);
        return Buffer.from(toStr(args[0])).toString('base64url');
    },

    base64UrlDecode: (args) => {
        requireArgs('crypto.base64UrlDecode', args, 1);
        return Buffer.from(toStr(args[0]), 'base64url').toString('utf-8');
    },

    hexEncode: (args) => {
        requireArgs('crypto.hexEncode', args, 1);
        return Buffer.from(toStr(args[0])).toString('hex');
    },

    hexDecode: (args) => {
        requireArgs('crypto.hexDecode', args, 1);
        return Buffer.from(toStr(args[0]), 'hex').toString('utf-8');
    },

    // --- Info ---

    ciphers: () => getCiphers(),

    hashes: () => getHashes()
};

export const CryptoNativeFunctionMetadata = {
    hash: {
        description: 'Hash data with any supported algorithm',
        parameters: [
            { name: 'algorithm', dataType: 'string', description: 'Hash algorithm (md5, sha256, sha512, etc.)', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to hash', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Output encoding (hex, base64)', formInputType: 'text', required: false, defaultValue: 'hex' }
        ],
        returnType: 'string', returnDescription: 'Hash digest', example: 'crypto.hash "sha256" "hello"'
    },
    md5: {
        description: 'MD5 hash',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to hash', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'MD5 hex digest', example: 'crypto.md5 "hello"'
    },
    sha1: {
        description: 'SHA-1 hash',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to hash', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'SHA-1 hex digest', example: 'crypto.sha1 "hello"'
    },
    sha256: {
        description: 'SHA-256 hash',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to hash', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'SHA-256 hex digest', example: 'crypto.sha256 "hello"'
    },
    sha512: {
        description: 'SHA-512 hash',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to hash', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'SHA-512 hex digest', example: 'crypto.sha512 "hello"'
    },
    hmac: {
        description: 'HMAC with any algorithm',
        parameters: [
            { name: 'algorithm', dataType: 'string', description: 'Hash algorithm', formInputType: 'text', required: true },
            { name: 'key', dataType: 'string', description: 'Secret key', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to sign', formInputType: 'text', required: true },
            { name: 'encoding', dataType: 'string', description: 'Output encoding', formInputType: 'text', required: false, defaultValue: 'hex' }
        ],
        returnType: 'string', returnDescription: 'HMAC digest', example: 'crypto.hmac "sha256" "secret" "data"'
    },
    hmacSha256: {
        description: 'HMAC-SHA256',
        parameters: [
            { name: 'key', dataType: 'string', description: 'Secret key', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to sign', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'HMAC-SHA256 hex digest', example: 'crypto.hmacSha256 "secret" "data"'
    },
    hmacSha512: {
        description: 'HMAC-SHA512',
        parameters: [
            { name: 'key', dataType: 'string', description: 'Secret key', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to sign', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'HMAC-SHA512 hex digest', example: 'crypto.hmacSha512 "secret" "data"'
    },
    encrypt: {
        description: 'Encrypt data with AES (returns iv:ciphertext)',
        parameters: [
            { name: 'algorithm', dataType: 'string', description: 'Cipher algorithm (default: aes-256-cbc)', formInputType: 'text', required: false, defaultValue: 'aes-256-cbc' },
            { name: 'key', dataType: 'string', description: 'Encryption key (hashed to 32 bytes)', formInputType: 'text', required: true },
            { name: 'data', dataType: 'string', description: 'Data to encrypt', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'iv:encryptedHex string', example: 'crypto.encrypt "aes-256-cbc" "mykey" "secret data"'
    },
    decrypt: {
        description: 'Decrypt data from encrypt() output',
        parameters: [
            { name: 'algorithm', dataType: 'string', description: 'Cipher algorithm', formInputType: 'text', required: false, defaultValue: 'aes-256-cbc' },
            { name: 'key', dataType: 'string', description: 'Encryption key', formInputType: 'text', required: true },
            { name: 'encryptedData', dataType: 'string', description: 'iv:ciphertext from encrypt()', formInputType: 'text', required: true }
        ],
        returnType: 'string', returnDescription: 'Decrypted string', example: 'crypto.decrypt "aes-256-cbc" "mykey" $encrypted'
    },
    randomBytes: {
        description: 'Generate random bytes',
        parameters: [
            { name: 'size', dataType: 'number', description: 'Number of bytes (default: 32)', formInputType: 'number', required: false, defaultValue: 32 },
            { name: 'encoding', dataType: 'string', description: 'Output encoding (hex, base64)', formInputType: 'text', required: false, defaultValue: 'hex' }
        ],
        returnType: 'string', returnDescription: 'Random bytes as encoded string', example: 'crypto.randomBytes 16'
    },
    randomUUID: {
        description: 'Generate a random UUID v4',
        parameters: [],
        returnType: 'string', returnDescription: 'UUID v4 string', example: 'crypto.randomUUID'
    },
    randomInt: {
        description: 'Generate a random integer',
        parameters: [
            { name: 'min', dataType: 'number', description: 'Minimum (or max if single arg)', formInputType: 'number', required: false, defaultValue: 0 },
            { name: 'max', dataType: 'number', description: 'Maximum (exclusive)', formInputType: 'number', required: false, defaultValue: 100 }
        ],
        returnType: 'number', returnDescription: 'Random integer', example: 'crypto.randomInt 1 100'
    },
    pbkdf2: {
        description: 'Derive key using PBKDF2',
        parameters: [
            { name: 'password', dataType: 'string', description: 'Password', formInputType: 'text', required: true },
            { name: 'salt', dataType: 'string', description: 'Salt', formInputType: 'text', required: true },
            { name: 'iterations', dataType: 'number', description: 'Iterations (default: 100000)', formInputType: 'number', required: false, defaultValue: 100000 },
            { name: 'keylen', dataType: 'number', description: 'Key length (default: 64)', formInputType: 'number', required: false, defaultValue: 64 },
            { name: 'digest', dataType: 'string', description: 'Digest algorithm (default: sha512)', formInputType: 'text', required: false, defaultValue: 'sha512' }
        ],
        returnType: 'string', returnDescription: 'Derived key as hex', example: 'crypto.pbkdf2 "password" "salt"'
    },
    scrypt: {
        description: 'Derive key using scrypt',
        parameters: [
            { name: 'password', dataType: 'string', description: 'Password', formInputType: 'text', required: true },
            { name: 'salt', dataType: 'string', description: 'Salt', formInputType: 'text', required: true },
            { name: 'keylen', dataType: 'number', description: 'Key length (default: 64)', formInputType: 'number', required: false, defaultValue: 64 }
        ],
        returnType: 'string', returnDescription: 'Derived key as hex', example: 'crypto.scrypt "password" "salt"'
    },
    base64Encode: {
        description: 'Encode string to Base64',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Base64 encoded string', example: 'crypto.base64Encode "hello"'
    },
    base64Decode: {
        description: 'Decode Base64 to string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Base64 data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decoded string', example: 'crypto.base64Decode "aGVsbG8="'
    },
    base64UrlEncode: {
        description: 'Encode string to URL-safe Base64',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Base64url encoded string', example: 'crypto.base64UrlEncode "hello"'
    },
    base64UrlDecode: {
        description: 'Decode URL-safe Base64 to string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Base64url data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decoded string', example: 'crypto.base64UrlDecode "aGVsbG8"'
    },
    hexEncode: {
        description: 'Encode string to hex',
        parameters: [{ name: 'data', dataType: 'string', description: 'Data to encode', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Hex encoded string', example: 'crypto.hexEncode "hello"'
    },
    hexDecode: {
        description: 'Decode hex to string',
        parameters: [{ name: 'data', dataType: 'string', description: 'Hex data', formInputType: 'text', required: true }],
        returnType: 'string', returnDescription: 'Decoded string', example: 'crypto.hexDecode "68656c6c6f"'
    },
    ciphers: {
        description: 'List all supported cipher algorithms',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of cipher names', example: 'crypto.ciphers'
    },
    hashes: {
        description: 'List all supported hash algorithms',
        parameters: [],
        returnType: 'array', returnDescription: 'Array of hash names', example: 'crypto.hashes'
    }
};

export const CryptoNativeModuleMetadata = {
    description: 'Cryptographic operations: hashing, HMAC, encryption, key derivation, random generation, and encoding',
    methods: Object.keys(CryptoNativeFunctions)
};

export default {
    name: 'crypto',
    functions: CryptoNativeFunctions,
    functionMetadata: CryptoNativeFunctionMetadata,
    moduleMetadata: CryptoNativeModuleMetadata,
    global: false
};
