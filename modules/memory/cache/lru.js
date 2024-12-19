import { AsyncLock } from '../../concurrency';

class LRUCache {
    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new Error('Cache capacity must be a positive integer');
        }
        this.capacity = capacity;
        this.cache = new Map();
        this.head = { key: null, value: null, prev: null, next: null };
        this.tail = { key: null, value: null, prev: this.head, next: null };
        this.head.next = this.tail;
        this.lock = new AsyncLock();
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }

    async get(key) {
        return await this.lock.acquire('get', () => {
            const node = this.cache.get(key);
            if (node) {
                this.stats.hits++;
                this.moveToFront(node);
                return node.value;
            }
            this.stats.misses++;
            return undefined;
        });
    }

    async set(key, value) {
        return await this.lock.acquire('set', () => {
            const existingNode = this.cache.get(key);

            if (existingNode) {
                // Update existing node
                existingNode.value = value;
                this.moveToFront(existingNode);
                return;
            }

            // Create new node
            const newNode = {
                key,
                value,
                prev: this.head,
                next: this.head.next
            };

            // Add to doubly-linked list
            this.head.next.prev = newNode;
            this.head.next = newNode;

            // Add to cache
            this.cache.set(key, newNode);

            // Check capacity
            if (this.cache.size > this.capacity) {
                this.evictOldest();
            }
        });
    }

    async delete(key) {
        return await this.lock.acquire('delete', () => {
            const node = this.cache.get(key);
            if (node) {
                this.removeNode(node);
                this.cache.delete(key);
                return true;
            }
            return false;
        });
    }

    async clear() {
        return await this.lock.acquire('clear', () => {
            this.cache.clear();
            this.head.next = this.tail;
            this.tail.prev = this.head;
            this.resetStats();
        });
    }

    async evictOldest() {
        return await this.lock.acquire('evict', () => {
            if (this.tail.prev === this.head) {
                return false; // Cache is empty
            }

            const oldestNode = this.tail.prev;
            this.removeNode(oldestNode);
            this.cache.delete(oldestNode.key);
            this.stats.evictions++;
            return true;
        });
    }

    moveToFront(node) {
        // Remove from current position
        this.removeNode(node);

        // Add to front
        node.prev = this.head;
        node.next = this.head.next;
        this.head.next.prev = node;
        this.head.next = node;
    }

    removeNode(node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    size() {
        return this.cache.size;
    }

    has(key) {
        return this.cache.has(key);
    }

    *entries() {
        let node = this.head.next;
        while (node !== this.tail) {
            yield [node.key, node.value];
            node = node.next;
        }
    }

    *keys() {
        let node = this.head.next;
        while (node !== this.tail) {
            yield node.key;
            node = node.next;
        }
    }

    *values() {
        let node = this.head.next;
        while (node !== this.tail) {
            yield node.value;
            node = node.next;
        }
    }

    async getStats() {
        return await this.lock.acquire('stats', () => ({
            ...this.stats,
            size: this.cache.size,
            capacity: this.capacity,
            hitRate: this.calculateHitRate(),
            evictionRate: this.calculateEvictionRate()
        }));
    }

    calculateHitRate() {
        const total = this.stats.hits + this.stats.misses;
        return total === 0 ? 0 : this.stats.hits / total;
    }

    calculateEvictionRate() {
        const total = this.stats.hits + this.stats.misses;
        return total === 0 ? 0 : this.stats.evictions / total;
    }

    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }

    async optimize() {
        return await this.lock.acquire('optimize', () => {
            // Analyze access patterns and adjust capacity if needed
            const hitRate = this.calculateHitRate();
            const evictionRate = this.calculateEvictionRate();

            // If hit rate is high and eviction rate is low, we might be over-provisioned
            if (hitRate > 0.9 && evictionRate < 0.1) {
                this.capacity = Math.max(Math.floor(this.capacity * 0.8), 1);
                while (this.cache.size > this.capacity) {
                    this.evictOldest();
                }
            }

            // If hit rate is low and eviction rate is high, we might need more capacity
            if (hitRate < 0.5 && evictionRate > 0.5) {
                this.capacity = Math.min(Math.floor(this.capacity * 1.5), Number.MAX_SAFE_INTEGER);
            }

            return {
                newCapacity: this.capacity,
                hitRate,
                evictionRate
            };
        });
    }

    async peek(key) {
        return await this.lock.acquire('peek', () => {
            const node = this.cache.get(key);
            return node ? node.value : undefined;
        });
    }

    async peekOldest() {
        return await this.lock.acquire('peekOldest', () => {
            if (this.tail.prev === this.head) {
                return undefined;
            }
            return {
                key: this.tail.prev.key,
                value: this.tail.prev.value
            };
        });
    }

    async peekNewest() {
        return await this.lock.acquire('peekNewest', () => {
            if (this.head.next === this.tail) {
                return undefined;
            }
            return {
                key: this.head.next.key,
                value: this.head.next.value
            };
        });
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    async destroy() {
        return await this.lock.acquire('destroy', () => {
            this.clear();
            this.head = null;
            this.tail = null;
            this.cache = null;
            this.stats = null;
        });
    }
}

module.exports = { LRUCache };