/**
 * RobinPath CLI — AI configuration: encryption, read/write config
 */
import { join } from 'node:path';
import { homedir, platform, hostname, userInfo } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { getRobinPathHome } from './utils';

// ============================================================================
// Constants
// ============================================================================

export const AI_CONFIG_PATH: string = join(homedir(), '.robinpath', 'ai.json');
export const AI_SESSIONS_DIR: string = join(homedir(), '.robinpath', 'ai-sessions');
export const AI_BRAIN_URL: string = process.env.ROBINPATH_AI_BRAIN_URL || 'https://ai-brain.robinpath.com';

// ============================================================================
// Interfaces
// ============================================================================

export interface AiConfig {
    apiKey?: string | null;
    apiKeyEncrypted?: string;
    model?: string;
    [key: string]: unknown;
}

// ============================================================================
// Encryption
// ============================================================================

/** Derive a machine-specific encryption key from hostname + username + fixed salt */
export function getAiEncryptionKey(): Buffer {
    const material = `robinpath-ai-${hostname()}-${userInfo().username}-v1`;
    return createHash('sha256').update(material).digest();
}

export function encryptApiKey(plaintext: string): string {
    const key = getAiEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decryptApiKey(stored: string): string | null {
    try {
        const key = getAiEncryptionKey();
        const [ivHex, tagHex, encrypted] = stored.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    } catch {
        return null;
    }
}

// ============================================================================
// Config read / write
// ============================================================================

export function readAiConfig(): AiConfig {
    try {
        if (!existsSync(AI_CONFIG_PATH)) return {};
        const raw: AiConfig = JSON.parse(readFileSync(AI_CONFIG_PATH, 'utf-8'));
        // Decrypt the API key if it's encrypted
        if (raw.apiKeyEncrypted) {
            const decrypted = decryptApiKey(raw.apiKeyEncrypted);
            if (decrypted) {
                raw.apiKey = decrypted;
            } else {
                raw.apiKey = null; // Decryption failed (different machine?)
            }
            delete raw.apiKeyEncrypted;
        }
        return raw;
    } catch {
        return {};
    }
}

export function writeAiConfig(config: AiConfig): void {
    const dir = getRobinPathHome();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Encrypt the API key before saving
    const toSave: AiConfig = { ...config };
    if (toSave.apiKey) {
        toSave.apiKeyEncrypted = encryptApiKey(toSave.apiKey);
        delete toSave.apiKey;
    }
    writeFileSync(AI_CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
    if (platform() !== 'win32') {
        try {
            chmodSync(AI_CONFIG_PATH, 0o600);
        } catch {
            /* ignore */
        }
    }
}
