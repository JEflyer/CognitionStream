// tests/test-setup.js

import {jest} from '@jest/globals';

// Mock implementation of crypto for tests
const mockCrypto = {
  subtle: {
      digest: jest.fn().mockImplementation(() => Promise.resolve(new ArrayBuffer(32))),
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