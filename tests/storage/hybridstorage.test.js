import { HybridStorage } from '../../modules/storage/hybridStorage';
import { CompressionUtil } from '../../modules/storage/utils/compression';
import { StorageMetrics } from '../../modules/storage/utils/metrics';
import { setupTestEnvironment, cleanupTestEnvironment, delay } from '../test-setup';

describe('HybridStorage', () => {
    let storage;

    beforeEach(() => {
        setupTestEnvironment();
        storage = new HybridStorage({
            dbName: 'test-storage',
            maxMemoryItems: 100
        });
    });

    afterEach(async () => {
        if (storage) {
            await storage.destroy();
        }
        cleanupTestEnvironment();
    });

    describe('Basic Operations', () => {
        it('should store and retrieve data', async () => {
            await storage.set('key1', { test: 'data' });
            const result = await storage.get('key1');
            expect(result).toEqual({ test: 'data' });
        });

        it('should handle non-existent keys', async () => {
            const result = await storage.get('nonexistent');
            expect(result).toBeNull();
        });

        it('should delete data', async () => {
            await storage.set('key1', { test: 'data' });
            await storage.delete('key1');
            const result = await storage.get('key1');
            expect(result).toBeNull();
        });

        it('should check key existence', async () => {
            await storage.set('key1', { test: 'data' });
            expect(await storage.has('key1')).toBe(true);
            expect(await storage.has('nonexistent')).toBe(false);
        });

        it('should clear all data', async () => {
            await storage.set('key1', { test: 'data1' });
            await storage.set('key2', { test: 'data2' });
            await storage.clear();
            expect(await storage.get('key1')).toBeNull();
            expect(await storage.get('key2')).toBeNull();
        });
    });

    describe('Memory Management', () => {
        it('should respect memory limits', async () => {
            // Add more items than maxMemoryItems
            for (let i = 0; i < 150; i++) {
                await storage.set(`key${i}`, { data: `value${i}` });
            }

            // Check that memory store size doesn't exceed limit
            expect(storage.memoryStore.size).toBeLessThanOrEqual(100);
        });

        it('should handle large data sets', async () => {
            const largeData = new Array(1000).fill('test').join('');
            await storage.set('largeKey', largeData);
            const result = await storage.get('largeKey');
            expect(result).toBe(largeData);
        });

        it('should prioritize frequently accessed items in memory', async () => {
            // Add multiple items
            for (let i = 0; i < 50; i++) {
                await storage.set(`key${i}`, { data: `value${i}` });
            }

            // Frequently access one item
            for (let i = 0; i < 10; i++) {
                await storage.get('key1');
            }

            // Add more items to trigger memory limit
            for (let i = 50; i < 150; i++) {
                await storage.set(`key${i}`, { data: `value${i}` });
            }

            // Frequently accessed item should still be in memory
            expect(storage.memoryStore.has('key1')).toBe(true);
        });
    });

    describe('Compression', () => {
        it('should compress data when specified', async () => {
            const originalData = { test: 'data'.repeat(100) };
            await storage.set('key1', originalData, { compression: true });
            
            // Get compressed data directly from store
            const stored = storage.memoryStore.get('key1');
            expect(stored.compressed).toBe(true);
            
            // Retrieved data should be decompressed
            const retrieved = await storage.get('key1');
            expect(retrieved).toEqual(originalData);
        });

        it('should handle compression errors gracefully', async () => {
            // Mock compression failure
            jest.spyOn(CompressionUtil, 'compress').mockRejectedValue(new Error('Compression failed'));
            
            const data = { test: 'data' };
            await expect(storage.set('key1', data, { compression: true }))
                .rejects.toThrow();
        });
    });

    describe('Query Operations', () => {
        it('should query by tags', async () => {
            await storage.set('key1', { data: 'value1' }, { tags: ['tag1'] });
            await storage.set('key2', { data: 'value2' }, { tags: ['tag1', 'tag2'] });
            await storage.set('key3', { data: 'value3' }, { tags: ['tag2'] });

            const results = await storage.query({ tags: ['tag1'] });
            expect(results.items.size).toBe(2);
            expect(results.totalCount).toBe(2);
        });

        it('should query by priority', async () => {
            await storage.set('key1', { data: 'value1' }, { priority: 1 });
            await storage.set('key2', { data: 'value2' }, { priority: 2 });
            await storage.set('key3', { data: 'value3' }, { priority: 0 });

            const results = await storage.query({ minPriority: 1 });
            expect(results.items.size).toBe(2);
        });

        it('should handle complex queries', async () => {
            await storage.set('key1', { data: 'value1' }, { 
                tags: ['tag1'], 
                priority: 1 
            });
            await storage.set('key2', { data: 'value2' }, { 
                tags: ['tag1', 'tag2'], 
                priority: 2 
            });

            const results = await storage.query({ 
                tags: ['tag1'],
                minPriority: 2
            });
            expect(results.items.size).toBe(1);
        });
    });

    describe('Optimization & Maintenance', () => {
        it('should vacuum expired items', async () => {
            await storage.set('key1', { data: 'value1' }, { expiry: 100 }); // Expire after 100ms
            await storage.set('key2', { data: 'value2' }); // No expiry

            await delay(150); // Wait for expiration
            const expiredCount = await storage.vacuum();
            
            expect(expiredCount).toBe(1);
            expect(await storage.get('key1')).toBeNull();
            expect(await storage.get('key2')).not.toBeNull();
        });

        it('should optimize storage based on access patterns', async () => {
            // Add items with different access patterns
            for (let i = 0; i < 50; i++) {
                await storage.set(`key${i}`, { data: `value${i}` });
                if (i < 10) {
                    // Frequently access some items
                    for (let j = 0; j < 5; j++) {
                        await storage.get(`key${i}`);
                    }
                }
            }

            await storage.optimize();
            const metrics = await storage.getUsageMetrics();
            expect(metrics.hitRate).toBeGreaterThan(0);
        });

        it('should compact database when fragmentation is high', async () => {
            // Create fragmentation by adding and deleting items
            for (let i = 0; i < 100; i++) {
                await storage.set(`key${i}`, { data: `value${i}` });
            }
            for (let i = 0; i < 50; i++) {
                await storage.delete(`key${i}`);
            }

            const beforeSize = (await storage.getStorageStats()).totalSize;
            await storage.compactDB();
            const afterSize = (await storage.getStorageStats()).totalSize;
            
            expect(afterSize).toBeLessThan(beforeSize);
        });
    });

    describe('Error Handling', () => {
        it('should handle database connection errors', async () => {
            // Instead of closing the db, just set it to null to simulate connection error
            storage.db = null;

            await expect(storage.set('key1', { test: 'data' }))
                .rejects.toThrow('Database connection not established');
        });

        it('should handle concurrent operations', async () => {
            const operations = Array(10).fill(null).map((_, i) => 
                storage.set(`key${i}`, { data: `value${i}` })
            );

            await expect(Promise.all(operations)).resolves.not.toThrow();
        });

        it('should handle transaction failures', async () => {
            // Ensure db is not null here
            expect(storage.db).not.toBeNull();

            const mockTransaction = {
                objectStore: () => ({
                    put: () => ({
                        onerror: () => {},
                        onsuccess: () => {}
                    })
                }),
                onerror: () => {}
            };
            jest.spyOn(storage.db, 'transaction').mockReturnValue(mockTransaction);

            await expect(storage.set('key1', { test: 'data' }))
                .rejects.toThrow();
        });
    });

    describe('Metrics & Monitoring', () => {
        it('should track operation metrics', async () => {
            await storage.set('key1', { test: 'data' });
            await storage.get('key1');
            await storage.get('nonexistent');

            const metrics = storage.metrics;
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
            expect(metrics.writes).toBe(1);
        });

        it('should track access times', async () => {
            await storage.set('key1', { test: 'data' });
            await storage.get('key1');

            expect(storage.metrics.accessTimes.length).toBeGreaterThan(0);
        });

        it('should calculate storage statistics', async () => {
            await storage.set('key1', { test: 'data1' });
            await storage.set('key2', { test: 'data2' });

            const stats = await storage.getStorageStats();
            expect(stats.totalSize).toBeGreaterThan(0);
            expect(stats.usedSize).toBeGreaterThan(0);
        });
    });
});

describe('CompressionUtil', () => {
    beforeEach(setupTestEnvironment);
    afterEach(() => {
        cleanupTestEnvironment();
        jest.restoreAllMocks();
    });

    it('should compress and decompress data correctly', async () => {
        const originalData = 'test'.repeat(100);
        const compressed = await CompressionUtil.compress(originalData);
        const decompressed = await CompressionUtil.decompress(compressed);
        expect(decompressed).toBe(originalData);
    });

    it('should handle different data types', async () => {
        const testCases = [
            { test: 'string' },
            [1, 2, 3],
            123,
            true,
            { nested: { data: { here: true } } }
        ];

        for (const testCase of testCases) {
            const compressed = await CompressionUtil.compress(testCase);
            const decompressed = await CompressionUtil.decompress(compressed);
            expect(decompressed).toEqual(testCase);
        }
    });

    it('should handle empty input', async () => {
        const compressed = await CompressionUtil.compress('');
        const decompressed = await CompressionUtil.decompress(compressed);
        expect(decompressed).toBe('');
    });
});

describe('StorageMetrics', () => {
    let metrics;

    beforeEach(() => {
        setupTestEnvironment();
        metrics = new StorageMetrics();
    });

    afterEach(cleanupTestEnvironment);

    it('should track basic metrics', () => {
        metrics.recordHit();
        metrics.recordMiss();
        metrics.recordWrite();
        
        expect(metrics.metrics.hits).toBe(1);
        expect(metrics.metrics.misses).toBe(1);
        expect(metrics.metrics.writes).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
        metrics.recordHit();
        metrics.recordHit();
        metrics.recordMiss();
        
        expect(metrics.getHitRate()).toBe(2/3);
    });

    it('should analyze access patterns', () => {
        // Record some access patterns
        metrics.recordAccessTime(100);
        metrics.recordAccessTime(150);
        metrics.recordHit();
        metrics.recordWrite();

        const analysis = metrics.analyzeAccessPatterns();
        expect(analysis.averageAccessTime).toBeGreaterThan(0);
        expect(analysis.hitRate).toBeDefined();
        expect(analysis.writeRate).toBeDefined();
    });

    it('should reset metrics correctly', () => {
        metrics.recordHit();
        metrics.recordWrite();
        metrics.reset();

        expect(metrics.metrics.hits).toBe(0);
        expect(metrics.metrics.writes).toBe(0);
    });
});
