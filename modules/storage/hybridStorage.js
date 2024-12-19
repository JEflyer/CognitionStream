import { AsyncLock } from '../concurrency';
import { CompressionUtil } from './utils/compression';
import { StorageMetrics } from './utils/metrics';
import { ThoughtError } from '../errors/thoughtError';

class HybridStorage {
    constructor(options = {}) {
        this.memoryStore = new Map();
        this.dbName = options.dbName || 'hybridStorage';
        this.storeName = options.storeName || 'mainStore';
        this.maxMemoryItems = options.maxMemoryItems || 10000;
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        this.db = null;
        this.ready = this.initializeDB();
        this.lock = new AsyncLock();
        
        // Performance metrics
        this.metrics = {
            hits: 0,
            misses: 0,
            writes: 0,
            deletes: 0,
            errors: 0,
            accessTimes: [], // Array of recent access times
            maxAccessTimes: 1000 // Keep last 1000 access times
        };
    }

    async initializeDB() {
        let attempt = 0;
        while (attempt < this.maxRetries) {
            try {
                return await new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, 1);

                    request.onerror = () => reject(new Error(`Failed to open IndexedDB: ${request.error}`));
                    
                    request.onsuccess = () => {
                        this.db = request.result;
                        
                        // Handle connection loss
                        this.db.onclose = () => {
                            this.db = null;
                            this.ready = this.initializeDB();
                        };
                        
                        this.db.onerror = (event) => {
                            console.error('IndexedDB error:', event.target.error);
                            this.metrics.errors++;
                        };
                        
                        resolve();
                    };

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                            store.createIndex('priority', 'priority', { unique: false });
                            store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                            store.createIndex('size', 'size', { unique: false });
                        }
                    };
                });
            } catch (error) {
                attempt++;
                if (attempt === this.maxRetries) throw error;
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
        }
    }

    async ensureDBConnection() {
        if (!this.db) {
            await this.ready;
        }
        if (!this.db) {
            throw new Error('Database connection not established');
        }
    }

    async set(key, value, options = {}) {
        await this.ensureDBConnection();
        
        return this.lock.acquire(`write_${key}`, async () => {
            const startTime = performance.now();
            try {
                const item = {
                    key,
                    value,
                    timestamp: Date.now(),
                    priority: options.priority || 0,
                    tags: options.tags || [],
                    expiry: options.expiry,
                    size: this.calculateItemSize(value)
                };

                if (options.compression) {
                    item.value = await CompressionUtil.compress(value);
                    item.compressed = true;
                }

                // Store in memory if high priority or frequently accessed
                if (this.shouldStoreInMemory(item)) {
                    this.memoryStore.set(key, item);
                    this.enforceMemoryLimit();
                }

                // Store in IndexedDB
                await this.setInDB(item);
                this.metrics.writes++;
                this.recordAccessTime(performance.now() - startTime);
                
                return true;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async get(key) {
        await this.ensureDBConnection();
        
        return this.lock.acquire(`read_${key}`, async () => {
            const startTime = performance.now();
            try {
                // Check memory first
                if (this.memoryStore.has(key)) {
                    const item = this.memoryStore.get(key);
                    if (this.isExpired(item)) {
                        this.memoryStore.delete(key);
                        await this.delete(key);
                        return null;
                    }
                    
                    this.metrics.hits++;
                    this.recordAccessTime(performance.now() - startTime);
                    return item.compressed ? 
                        await CompressionUtil.decompress(item.value) : 
                        item.value;
                }

                // Check IndexedDB
                const item = await this.getFromDB(key);
                if (!item) {
                    this.metrics.misses++;
                    return null;
                }

                if (this.isExpired(item)) {
                    await this.delete(key);
                    return null;
                }

                // Cache in memory for future access
                if (this.shouldStoreInMemory(item)) {
                    this.memoryStore.set(key, item);
                    this.enforceMemoryLimit();
                }

                this.metrics.hits++;
                this.recordAccessTime(performance.now() - startTime);
                return item.compressed ? 
                    await CompressionUtil.decompress(item.value) : 
                    item.value;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async delete(key) {
        await this.ensureDBConnection();
        
        return this.lock.acquire(`delete_${key}`, async () => {
            const startTime = performance.now();
            try {
                // Remove from memory
                this.memoryStore.delete(key);

                // Remove from IndexedDB
                const result = await this.deleteFromDB(key);
                if (result) {
                    this.metrics.deletes++;
                }
                
                this.recordAccessTime(performance.now() - startTime);
                return result;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async has(key) {
        await this.ensureDBConnection();
        
        const startTime = performance.now();
        try {
            // Check memory first
            if (this.memoryStore.has(key)) {
                const item = this.memoryStore.get(key);
                if (!this.isExpired(item)) {
                    this.recordAccessTime(performance.now() - startTime);
                    return true;
                }
                this.memoryStore.delete(key);
            }

            // Check IndexedDB
            const exists = await this.existsInDB(key);
            this.recordAccessTime(performance.now() - startTime);
            return exists;
        } catch (error) {
            this.metrics.errors++;
            throw error;
        }
    }

    async clear() {
        await this.ensureDBConnection();
        
        return this.lock.acquire('clear', async () => {
            try {
                // Clear memory store
                this.memoryStore.clear();

                // Clear IndexedDB
                await this.clearDB();
                return true;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async query(filter) {
        await this.ensureDBConnection();
        
        return this.lock.acquire('query', async () => {
            const startTime = performance.now();
            try {
                const results = await this.queryDB(filter);
                this.recordAccessTime(performance.now() - startTime);
                return results;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async optimize() {
        await this.ensureDBConnection();
        
        return this.lock.acquire('optimize', async () => {
            try {
                // Clear expired items
                await this.vacuum();

                // Analyze access patterns
                const accessPatterns = this.analyzeAccessPatterns();

                // Adjust memory store size based on hit rate
                this.optimizeMemoryStoreSize(accessPatterns);

                // Compact IndexedDB if needed
                if (accessPatterns.fragmentation > 0.3) { // 30% fragmentation threshold
                    await this.compactDB();
                }

                return true;
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    async vacuum() {
        await this.ensureDBConnection();
        
        return this.lock.acquire('vacuum', async () => {
            try {
                const expiredKeys = [];

                // Check memory store
                for (const [key, item] of this.memoryStore) {
                    if (this.isExpired(item)) {
                        this.memoryStore.delete(key);
                        expiredKeys.push(key);
                    }
                }

                // Check IndexedDB
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const index = store.index('timestamp');

                return new Promise((resolve, reject) => {
                    index.openCursor().onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            const item = cursor.value;
                            if (this.isExpired(item)) {
                                cursor.delete();
                                expiredKeys.push(item.key);
                            }
                            cursor.continue();
                        } else {
                            resolve(expiredKeys.length);
                        }
                    };
                });
            } catch (error) {
                this.metrics.errors++;
                throw error;
            }
        });
    }

    // Private helper methods
    async setInDB(item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(item);

            request.onerror = () => reject(new Error(`Failed to store item: ${request.error}`));
            request.onsuccess = () => resolve(true);
        });
    }

    async getFromDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onerror = () => reject(new Error(`Failed to retrieve item: ${request.error}`));
            request.onsuccess = () => resolve(request.result || null);
        });
    }

    async deleteFromDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onerror = () => reject(new Error(`Failed to delete item: ${request.error}`));
            request.onsuccess = () => resolve(true);
        });
    }

    async existsInDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.count(key);

            request.onerror = () => reject(new Error(`Failed to check item existence: ${request.error}`));
            request.onsuccess = () => resolve(request.result > 0);
        });
    }

    async clearDB() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onerror = () => reject(new Error(`Failed to clear store: ${request.error}`));
            request.onsuccess = () => resolve(true);
        });
    }

    async queryDB(filter) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const results = new Map();
            let count = 0;

            let request;
            if (filter.tags && filter.tags.length > 0) {
                const tagIndex = store.index('tags');
                request = tagIndex.openCursor();
            } else if (filter.minPriority !== undefined) {
                const priorityIndex = store.index('priority');
                request = priorityIndex.openCursor(IDBKeyRange.lowerBound(filter.minPriority));
            } else {
                request = store.openCursor();
            }

            request.onerror = () => reject(new Error(`Query failed: ${request.error}`));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    if (this.matchesFilter(item, filter) && !this.isExpired(item)) {
                        results.set(item.key, item.value);
                        count++;
                    }
                    cursor.continue();
                } else {
                    resolve({
                        items: results,
                        totalCount: count,
                        metrics: {
                            executionTime: Date.now() - transaction.startTime,
                            itemsScanned: count,
                            resultSize: results.size
                        }
                    });
                }
            };
        });
    }

    async compactDB() {
        await this.ensureDBConnection();
        
        return this.lock.acquire('compact', async () => {
            try {
                // Create a new database with the same data but defragmented
                const tempDBName = `${this.dbName}_temp`;
                
                // Get all current data
                const allData = await this.getAllItems();
                
                // Close current connection
                this.db.close();
                
                // Delete current database
                await new Promise((resolve, reject) => {
                    const deleteRequest = indexedDB.deleteDatabase(this.dbName);
                    deleteRequest.onerror = () => reject(new Error('Failed to delete old database'));
                    deleteRequest.onsuccess = () => resolve();
                });
                
                // Reinitialize database
                await this.initializeDB();
                
                // Reinsert all data
                for (const item of allData) {
                    await this.setInDB(item);
                }
                
                return true;
            } catch (error) {
                this.metrics.errors++;
                throw new Error(`Database compaction failed: ${error.message}`);
            }
        });
    }

    async getAllItems() {
        return new Promise((resolve, reject) => {
            const items = [];
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();

            request.onerror = () => reject(new Error('Failed to get all items'));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (!this.isExpired(cursor.value)) {
                        items.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(items);
                }
            };
        });
    }

    isExpired(item) {
        return item.expiry && Date.now() > item.timestamp + item.expiry;
    }

    shouldStoreInMemory(item) {
        if (!item) return false;
        
        // Always store high priority items
        if (item.priority > 0) return true;
        
        // Don't store large items
        if (item.size > 100000) return false; // 100KB limit
        
        // Store recently accessed items
        const isRecent = Date.now() - item.timestamp < 300000; // 5 minutes
        
        // Store frequently accessed items
        const accessCount = this.getAccessCount(item.key);
        const isFrequent = accessCount > 5;
        
        return isRecent || isFrequent;
    }

    getAccessCount(key) {
        // This would be implemented with a proper access tracking system
        // For now, return 0 to keep the implementation simple
        return 0;
    }

    enforceMemoryLimit() {
        if (this.memoryStore.size <= this.maxMemoryItems) return;

        // Sort items by priority and last access
        const items = Array.from(this.memoryStore.entries())
            .map(([key, item]) => ({
                key,
                priority: item.priority,
                lastAccess: item.timestamp
            }))
            .sort((a, b) => {
                // Sort by priority first, then by last access time
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                return a.lastAccess - b.lastAccess;
            });

        // Remove lowest priority/least recently used items
        while (this.memoryStore.size > this.maxMemoryItems) {
            const item = items.shift();
            if (item) {
                this.memoryStore.delete(item.key);
            }
        }
    }

    calculateItemSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // Approximate UTF-16 string size
        }
        return JSON.stringify(value).length * 2;
    }

    recordAccessTime(duration) {
        this.metrics.accessTimes.push(duration);
        if (this.metrics.accessTimes.length > this.metrics.maxAccessTimes) {
            this.metrics.accessTimes.shift();
        }
    }

    analyzeAccessPatterns() {
        const now = Date.now();
        const analysis = {
            averageAccessTime: 0,
            hitRate: 0,
            fragmentation: 0
        };

        // Calculate average access time
        if (this.metrics.accessTimes.length > 0) {
            analysis.averageAccessTime = this.metrics.accessTimes.reduce((a, b) => a + b, 0) 
                / this.metrics.accessTimes.length;
        }

        // Calculate hit rate
        const totalAccesses = this.metrics.hits + this.metrics.misses;
        if (totalAccesses > 0) {
            analysis.hitRate = this.metrics.hits / totalAccesses;
        }

        // Estimate fragmentation
        analysis.fragmentation = this.estimateFragmentation();

        return analysis;
    }

    async estimateFragmentation() {
        try {
            const stats = await this.getStorageStats();
            return 1 - (stats.usedSize / stats.totalSize);
        } catch {
            return 0;
        }
    }

    async getStorageStats() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const countRequest = store.count();
            let totalSize = 0;
            let usedSize = 0;

            countRequest.onsuccess = () => {
                const cursor = store.openCursor();
                cursor.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const item = cursor.value;
                        usedSize += this.calculateItemSize(item.value);
                        cursor.continue();
                    } else {
                        resolve({
                            totalSize: store.count * 1000, // Rough estimate
                            usedSize: usedSize
                        });
                    }
                };
            };
            countRequest.onerror = () => reject(new Error('Failed to get storage stats'));
        });
    }

    optimizeMemoryStoreSize() {
        const analysis = this.analyzeAccessPatterns();
        
        // Adjust memory store size based on hit rate
        if (analysis.hitRate > 0.8 && this.metrics.errors < 100) {
            this.maxMemoryItems = Math.min(
                this.maxMemoryItems * 1.2, // Increase by 20%
                100000 // Hard limit
            );
        } else if (analysis.hitRate < 0.4 || this.metrics.errors > 1000) {
            this.maxMemoryItems = Math.max(
                this.maxMemoryItems * 0.8, // Decrease by 20%
                1000 // Minimum size
            );
        }
    }

    async destroy() {
        await this.ensureDBConnection();
        
        try {
            // Clear memory store
            this.memoryStore.clear();
            
            // Close database connection
            this.db.close();
            
            // Delete database
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(this.dbName);
                request.onerror = () => reject(new Error('Failed to delete database'));
                request.onsuccess = () => resolve();
            });
            
            return true;
        } catch (error) {
            throw new Error(`Failed to destroy storage: ${error.message}`);
        }
    }

    matchesFilter(item, filter) {
        if (!item) return false;

        if (filter.tags && !filter.tags.every(tag => item.tags.includes(tag))) {
            return false;
        }

        if (filter.createdAfter && item.timestamp < filter.createdAfter.getTime()) {
            return false;
        }

        if (filter.createdBefore && item.timestamp > filter.createdBefore.getTime()) {
            return false;
        }

        if (filter.minPriority !== undefined && item.priority < filter.minPriority) {
            return false;
        }

        if (filter.maxSize !== undefined && item.size > filter.maxSize) {
            return false;
        }

        return true;
    }
}