/**
 * Native events module for RobinPath.
 * EventEmitter pattern for pub/sub communication.
 */
import { EventEmitter } from 'node:events';
import { toStr, requireArgs } from './_helpers.js';

const _emitters = new Map();
let _nextId = 1;

export const EventsFunctions = {

    create: () => {
        const id = `emitter_${_nextId++}`;
        _emitters.set(id, new EventEmitter());
        return id;
    },

    on: (args, callback) => {
        requireArgs('events.on', args, 2);
        const id = toStr(args[0]);
        const event = toStr(args[1]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.on: emitter ${id} not found`);
        if (callback) {
            emitter.on(event, (...eventArgs) => callback(eventArgs));
        }
        return true;
    },

    once: (args, callback) => {
        requireArgs('events.once', args, 2);
        const id = toStr(args[0]);
        const event = toStr(args[1]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.once: emitter ${id} not found`);
        if (callback) {
            emitter.once(event, (...eventArgs) => callback(eventArgs));
        }
        return true;
    },

    emit: (args) => {
        requireArgs('events.emit', args, 2);
        const id = toStr(args[0]);
        const event = toStr(args[1]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.emit: emitter ${id} not found`);
        return emitter.emit(event, ...args.slice(2));
    },

    off: (args) => {
        requireArgs('events.off', args, 2);
        const id = toStr(args[0]);
        const event = toStr(args[1]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.off: emitter ${id} not found`);
        emitter.removeAllListeners(event);
        return true;
    },

    listeners: (args) => {
        requireArgs('events.listeners', args, 2);
        const id = toStr(args[0]);
        const event = toStr(args[1]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.listeners: emitter ${id} not found`);
        return emitter.listenerCount(event);
    },

    eventNames: (args) => {
        requireArgs('events.eventNames', args, 1);
        const id = toStr(args[0]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.eventNames: emitter ${id} not found`);
        return emitter.eventNames();
    },

    removeAll: (args) => {
        requireArgs('events.removeAll', args, 1);
        const id = toStr(args[0]);
        const emitter = _emitters.get(id);
        if (!emitter) throw new Error(`events.removeAll: emitter ${id} not found`);
        emitter.removeAllListeners();
        return true;
    },

    destroy: (args) => {
        requireArgs('events.destroy', args, 1);
        const id = toStr(args[0]);
        const emitter = _emitters.get(id);
        if (emitter) {
            emitter.removeAllListeners();
            _emitters.delete(id);
            return true;
        }
        return false;
    },

    list: () => Array.from(_emitters.keys())
};

export const EventsFunctionMetadata = {
    create: { description: 'Create a new event emitter', parameters: [], returnType: 'string', returnDescription: 'Emitter handle ID', example: 'events.create' },
    on: {
        description: 'Listen for an event',
        parameters: [
            { name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true },
            { name: 'event', dataType: 'string', description: 'Event name', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true', example: 'events.on $emitter "data"'
    },
    once: {
        description: 'Listen for an event once',
        parameters: [
            { name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true },
            { name: 'event', dataType: 'string', description: 'Event name', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true', example: 'events.once $emitter "ready"'
    },
    emit: {
        description: 'Emit an event with arguments',
        parameters: [
            { name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true },
            { name: 'event', dataType: 'string', description: 'Event name', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true if listeners were called', example: 'events.emit $emitter "data" "payload"'
    },
    off: {
        description: 'Remove all listeners for an event',
        parameters: [
            { name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true },
            { name: 'event', dataType: 'string', description: 'Event name', formInputType: 'text', required: true }
        ],
        returnType: 'boolean', returnDescription: 'true', example: 'events.off $emitter "data"'
    },
    listeners: {
        description: 'Get listener count for an event',
        parameters: [
            { name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true },
            { name: 'event', dataType: 'string', description: 'Event name', formInputType: 'text', required: true }
        ],
        returnType: 'number', returnDescription: 'Number of listeners', example: 'events.listeners $emitter "data"'
    },
    eventNames: {
        description: 'Get all event names with listeners',
        parameters: [{ name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true }],
        returnType: 'array', returnDescription: 'Array of event names', example: 'events.eventNames $emitter'
    },
    removeAll: {
        description: 'Remove all listeners from an emitter',
        parameters: [{ name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true', example: 'events.removeAll $emitter'
    },
    destroy: {
        description: 'Destroy an emitter',
        parameters: [{ name: 'emitterId', dataType: 'string', description: 'Emitter handle', formInputType: 'text', required: true }],
        returnType: 'boolean', returnDescription: 'true if destroyed', example: 'events.destroy $emitter'
    },
    list: { description: 'List all active emitters', parameters: [], returnType: 'array', returnDescription: 'Array of emitter IDs', example: 'events.list' }
};

export const EventsModuleMetadata = {
    description: 'EventEmitter pattern: create emitters, listen, emit, and manage events',
    methods: Object.keys(EventsFunctions)
};

export default {
    name: 'events',
    functions: EventsFunctions,
    functionMetadata: EventsFunctionMetadata,
    moduleMetadata: EventsModuleMetadata,
    global: false
};
