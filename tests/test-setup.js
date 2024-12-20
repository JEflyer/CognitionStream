// tests/test-setup.js

import { jest } from '@jest/globals';
import { indexedDB, MockIDBDatabase, MockIDBIndex, MockIDBObjectStore, MockIDBRequest, MockIDBTransaction } from "./MockIndexedDB"
import { IDBKeyRange } from './MockIndexedDB.js';

global.IDBKeyRange = IDBKeyRange;

// Mock implementation of crypto for tests
const mockCrypto = {
    subtle: {
        digest: jest.fn().mockImplementation((algorithm, data) => {
            // Just ignore 'algorithm' since we know it's SHA-256
            // 'data' is an ArrayBuffer. Pass it directly to our sha256 function:
            const hashBuffer = sha256(data);

            // Return a promise that resolves with the computed hash ArrayBuffer
            return Promise.resolve(hashBuffer);
        }),
        generateKey: jest.fn(),
        sign: jest.fn(),
        verify: jest.fn()
    },
    getRandomValues: jest.fn().mockImplementation(arr => {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
    })
};

function sha256(buffer) {
    // Convert ArrayBuffer to array
    const bytes = new Uint8Array(buffer);

    // SHA-256 constants and functions
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const H = [
        0x6a09e667, 0xbb67ae85,
        0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c,
        0x1f83d9ab, 0x5be0cd19
    ];

    // Preprocessing
    const length = bytes.length;
    const bitLength = length * 8;

    // Append '1' bit
    const withOne = new Uint8Array(length + 1);
    withOne.set(bytes, 0);
    withOne[length] = 0x80;

    // Calculate the required padding
    let padLength = (64 - ((length + 9) % 64)) % 64;
    const padded = new Uint8Array(length + 1 + padLength + 8);
    padded.set(withOne, 0);

    // Append length in bits as a 64-bit big-endian integer
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLength, false);

    // Process the message in successive 512-bit chunks
    for (let i = 0; i < padded.length; i += 64) {
        const w = new Uint32Array(64);

        for (let j = 0; j < 16; j++) {
            w[j] = view.getUint32(i + j * 4, false);
        }

        for (let j = 16; j < 64; j++) {
            const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
            const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }

        let a = H[0], b = H[1], c = H[2], d = H[3];
        let e = H[4], f = H[5], g = H[6], h = H[7];

        for (let j = 0; j < 64; j++) {
            const S1 = (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25));
            const ch = ((e & f) ^ (~e & g));
            const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
            const S0 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22));
            const maj = ((a & b) ^ (a & c) ^ (b & c));
            const temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }

        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }

    // Convert H values to a single ArrayBuffer
    const result = new ArrayBuffer(32);
    const resultView = new DataView(result);
    for (let i = 0; i < 8; i++) {
        resultView.setUint32(i * 4, H[i], false);
    }

    return result;
}

function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}


// Helper to create mock nodes for graph testing
const createMockNode = (id, dependencies = []) => ({
    id,
    dependencies,
    type: 'test',
    execute: async () => `executed ${id}`
});

// Helper to create mock performance tracker
const createMockPerformanceTracker = () => ({
    getThought: jest.fn().mockImplementation(id => ({
        id,
        type: 'test',
        execute: async () => 'executed'
    })),
    getMetrics: jest.fn().mockImplementation(() => ({
        executionTime: 100,
        memoryUsage: 50,
        cpuUsage: 0.5
    })),
    getThoughtMetrics: jest.fn().mockImplementation(() => ({
        executionTime: 100,
        memoryUsage: 50,
        cpuUsage: 0.5
    }))
});

// Helper to wait for all promises to resolve
const flushPromises = () => new Promise(resolve => setImmediate(resolve));

// Helper to create a delay promise
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mock LRUCache class with full implementation
class MockLRUCache {
    constructor(capacity) {
        this.capacity = capacity;
        this.cache = new Map();
        this.head = { key: null, value: null, prev: null, next: null };
        this.tail = { key: null, value: null, prev: this.head, next: null };
        this.head.next = this.tail;
    }

    get(key) {
        const node = this.cache.get(key);
        if (node) {
            this.moveToFront(node);
            return node.value;
        }
        return undefined;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            node.value = value;
            this.moveToFront(node);
        } else {
            const node = {
                key,
                value,
                prev: this.head,
                next: this.head.next
            };
            this.cache.set(key, node);
            this.head.next.prev = node;
            this.head.next = node;

            if (this.cache.size > this.capacity) {
                const lru = this.tail.prev;
                this.removeNode(lru);
                this.cache.delete(lru.key);
            }
        }
    }

    moveToFront(node) {
        this.removeNode(node);
        node.prev = this.head;
        node.next = this.head.next;
        this.head.next.prev = node;
        this.head.next = node;
    }

    removeNode(node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    delete(key) {
        const node = this.cache.get(key);
        if (node) {
            this.removeNode(node);
            this.cache.delete(key);
            return true;
        }
        return false;
    }

    clear() {
        this.cache.clear();
        this.head.next = this.tail;
        this.tail.prev = this.head;
    }

    size() {
        return this.cache.size;
    }
}


// Setup test environment
const setupTestEnvironment = () => {
    // Mock window and global objects
    global.crypto = mockCrypto;

    // Mock fetch
    global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
        })
    );

    global.indexedDB = indexedDB;

    // Mock text encoder/decoder
    global.TextEncoder = jest.fn().mockImplementation(() => ({
        encode: jest.fn().mockImplementation(text => new Uint8Array([...text].map(c => c.charCodeAt(0))))
    }));

    global.TextDecoder = jest.fn().mockImplementation(() => ({
        decode: jest.fn().mockImplementation(arr => String.fromCharCode.apply(null, arr))
    }));

    // Mock performance API
    global.performance = {
        now: jest.fn(() => Date.now())
    };

    // Mock setImmediate if not available
    if (typeof setImmediate === 'undefined') {
        global.setImmediate = (callback) => setTimeout(callback, 0);
    }
};

// Cleanup test environment
const cleanupTestEnvironment = () => {
    jest.clearAllMocks();
    if (global.crypto) delete global.crypto;
    if (global.fetch) delete global.fetch;
    if (global.TextEncoder) delete global.TextEncoder;
    if (global.TextDecoder) delete global.TextDecoder;
};

export {
    createMockPerformanceTracker,
    createMockNode,
    flushPromises,
    delay,
    setupTestEnvironment,
    cleanupTestEnvironment,
    MockLRUCache
};