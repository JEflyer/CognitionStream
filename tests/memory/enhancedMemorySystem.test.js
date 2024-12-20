import { EnhancedMemorySystem } from '../../modules/memory/enhancedMemory';
import { setupTestEnvironment, cleanupTestEnvironment, delay } from '../test-setup';
import { ThoughtError } from '../../modules/errors/thoughtError';

describe('EnhancedMemorySystem', () => {
    let memorySystem;
    let mockStorage;
    let mockVectorStore;

    beforeEach(() => {
        setupTestEnvironment();

        // Create base mock storage with all required methods
        mockStorage = {
            set: jest.fn().mockResolvedValue(true),
            get: jest.fn().mockResolvedValue(null),
            delete: jest.fn().mockResolvedValue(true),
            clear: jest.fn().mockResolvedValue(true),
            vacuum: jest.fn().mockResolvedValue(0),
            optimize: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockResolvedValue(true),
            getMetrics: jest.fn().mockResolvedValue({
                totalItems: 0,
                totalSize: 0,
                hitRate: 0,
                averageAccessTime: 0
            })
        };

        // Create base mock vector store
        mockVectorStore = {
            add: jest.fn().mockResolvedValue(true),
            delete: jest.fn().mockResolvedValue(true),
            search: jest.fn().mockResolvedValue([]),
            clear: jest.fn().mockResolvedValue(true),
            releaseResources: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockResolvedValue(true),
            vacuum: jest.fn().mockResolvedValue(true),
            getUsageMetrics: jest.fn().mockResolvedValue({
                vectorCount: 0,
                dimensions: 128
            }),
            getEntryCount: jest.fn().mockResolvedValue(0),
            getDimensions: jest.fn().mockReturnValue(128)
        };

        // Create system with larger limits for testing
        memorySystem = new EnhancedMemorySystem({
            shortTermLimit: 10000,
            workingMemoryLimit: 5000,
            vectorLimit: 100000,
            cleanupInterval: 1000
        });

        // Replace implementations with mocks
        memorySystem.shortTermMemory = mockStorage;
        memorySystem.vectorStore = mockVectorStore;
        memorySystem.workingMemory = {
            set: jest.fn(),
            get: jest.fn(),
            has: jest.fn().mockReturnValue(false),
            delete: jest.fn(),
            clear: jest.fn(),
            size: jest.fn().mockReturnValue(0)
        };

        // Add spies for key methods
        jest.spyOn(memorySystem, 'calculateSize').mockReturnValue(100);
        jest.spyOn(memorySystem, 'compress').mockImplementation(data => data);
        jest.spyOn(memorySystem, 'decompress').mockImplementation(data => data);
    });

    afterEach(async () => {
        if (memorySystem) {
            try {
                await memorySystem.destroy().catch(() => {});
            } catch (error) {
                // Ignore cleanup errors in tests
            }
        }
        jest.restoreAllMocks();
        cleanupTestEnvironment();
    });

    describe('Basic Storage Operations', () => {
        it('should store and retrieve data correctly', async () => {
            const testData = { test: 'data' };
            
            mockStorage.get.mockResolvedValueOnce({
                data: testData,
                metadata: { timestamp: Date.now() }
            });

            await memorySystem.store('test-key', testData);
            const retrieved = await memorySystem.retrieve('test-key');
            
            expect(retrieved).toEqual(testData);
            expect(mockStorage.set).toHaveBeenCalled();
        });

        it('should handle different data types', async () => {
            const testCases = [
                ['string-key', 'test string'],
                ['number-key', 42],
                ['boolean-key', true],
                ['array-key', [1, 2, 3]],
                ['object-key', { nested: { data: true } }]
            ];

            for (const [key, value] of testCases) {
                mockStorage.get.mockResolvedValueOnce({
                    data: value,
                    metadata: { timestamp: Date.now() }
                });

                await memorySystem.store(key, value);
                const retrieved = await memorySystem.retrieve(key);
                expect(retrieved).toEqual(value);
            }
        });

        it('should handle empty or invalid inputs', async () => {
            await expect(memorySystem.store('', 'data'))
                .rejects.toThrow(ThoughtError);
            await expect(memorySystem.store('key', null))
                .rejects.toThrow(ThoughtError);
            await expect(memorySystem.store('key', undefined))
                .rejects.toThrow(ThoughtError);
        });

        it('should handle non-existent keys', async () => {
            mockStorage.get.mockResolvedValue(null);
            const result = await memorySystem.retrieve('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('Memory Management', () => {
        it('should handle memory limits', async () => {
            memorySystem.calculateSize.mockRestore();
            
            // First store within limits
            jest.spyOn(memorySystem, 'calculateSize').mockReturnValueOnce(100);
            await expect(memorySystem.store('key1', 'data1'))
                .resolves.toBeDefined();

            // Then exceed limits
            jest.spyOn(memorySystem, 'calculateSize').mockReturnValue(1000000);
            await expect(memorySystem.store('key2', 'data2'))
                .rejects.toThrow(ThoughtError);
        });

        it('should cleanup expired items', async () => {
            const now = Date.now();
            const dateSpy = jest.spyOn(Date, 'now');
            
            // Initial store time
            dateSpy.mockReturnValueOnce(now);
            
            await memorySystem.store('expire-key', 'test', 'shortTerm', {
                expiry: 100 // 100ms expiry
            });

            // Advance time
            dateSpy.mockReturnValue(now + 200);
            
            // Perform cleanup
            await memorySystem.performCleanup();
            
            expect(mockStorage.vacuum).toHaveBeenCalled();
            
            // Should return null for expired item
            mockStorage.get.mockResolvedValueOnce(null);
            const retrieved = await memorySystem.retrieve('expire-key');
            expect(retrieved).toBeNull();
        });

        it('should optimize storage based on usage', async () => {
            await memorySystem.store('key1', 'data1');
            
            // Simulate frequent access
            for (let i = 0; i < 5; i++) {
                mockStorage.get.mockResolvedValueOnce({
                    data: 'data1',
                    metadata: { timestamp: Date.now() }
                });
                await memorySystem.retrieve('key1');
            }

            await memorySystem.optimize();
            expect(mockStorage.optimize).toHaveBeenCalled();
        });
    });

    describe('Compression', () => {
        it('should compress large data', async () => {
            const largeData = { data: 'x'.repeat(1000) };
            const compressedData = { compressed: true, data: 'compressed' };
            
            jest.spyOn(memorySystem, 'compress')
                .mockResolvedValueOnce(compressedData);

            mockStorage.get.mockResolvedValueOnce({
                data: compressedData,
                metadata: { timestamp: Date.now() }
            });

            await memorySystem.store('large-key', largeData);
            await memorySystem.retrieve('large-key');

            expect(memorySystem.compress).toHaveBeenCalledWith(largeData);
        });

        it('should handle compression errors', async () => {
            jest.spyOn(memorySystem, 'compress')
                .mockRejectedValueOnce(new Error('Compression failed'));

            await expect(memorySystem.store('key', 'data'))
                .rejects.toThrow();
        });
    });

    describe('Resource Management', () => {
        it('should release resources properly', async () => {
            await memorySystem.releaseResources();
            
            expect(mockVectorStore.releaseResources).toHaveBeenCalled();
            expect(mockStorage.destroy).toHaveBeenCalled();
            expect(memorySystem.workingMemory.clear).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            mockStorage.vacuum.mockRejectedValueOnce(new Error('Cleanup failed'));

            // Should not throw
            await expect(memorySystem.performCleanup())
                .resolves.not.toThrow();
        });
    });

    describe('AI Integration', () => {
        beforeEach(() => {
            memorySystem.aiConfig = {
                endpoint: 'https://api.example.com',
                apiKey: 'test-key',
                compressionModel: 'test-model'
            };

            global.fetch = jest.fn();
        });

        it('should use AI compression when configured', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ compressed: true, data: 'compressed' })
            });

            mockStorage.get.mockResolvedValueOnce({
                data: { compressed: true, data: 'compressed' },
                metadata: { timestamp: Date.now() }
            });

            await memorySystem.store('ai-key', { test: 'data' });
            expect(global.fetch).toHaveBeenCalled();
        });

        it('should handle AI service errors', async () => {
            global.fetch.mockRejectedValueOnce(new Error('AI service error'));

            // Should fall back to regular storage
            await memorySystem.store('key', 'data');
            expect(mockStorage.set).toHaveBeenCalled();
        });
    });

    describe('Metrics and Monitoring', () => {
        it('should track memory usage metrics', async () => {
            const metrics = await memorySystem.getUsageMetrics();
            
            expect(metrics).toHaveProperty('shortTerm');
            expect(metrics).toHaveProperty('working');
            expect(metrics).toHaveProperty('vector');
            expect(metrics).toHaveProperty('totalEntries');
        });

        it('should track performance metrics', async () => {
            // Store and retrieve to generate metrics
            await memorySystem.store('test-key', 'test-data');
            await memorySystem.retrieve('test-key');

            const metrics = await memorySystem.getUsageMetrics();
            expect(metrics.shortTerm.hitRate).toBeDefined();
            expect(metrics.shortTerm.capacityUsed).toBeLessThanOrEqual(1);
        });
    });

    describe('Error Handling', () => {
        it('should handle storage errors', async () => {
            mockStorage.set.mockRejectedValueOnce(new Error('Storage error'));

            await expect(memorySystem.store('key', 'data'))
                .rejects.toThrow('Storage error');
        });

        it('should handle retrieval errors', async () => {
            mockStorage.get.mockRejectedValueOnce(new Error('Retrieval error'));

            await expect(memorySystem.retrieve('key'))
                .rejects.toThrow('Retrieval error');
        });

        it('should handle concurrent operations', async () => {
            const operations = Array(5).fill(null).map((_, i) => 
                memorySystem.store(`key${i}`, `data${i}`)
            );

            await expect(Promise.all(operations)).resolves.not.toThrow();
        });

        it('should handle resource cleanup errors', async () => {
            mockStorage.destroy.mockRejectedValueOnce(new Error('Cleanup error'));
            mockVectorStore.releaseResources.mockRejectedValueOnce(new Error('Vector cleanup error'));

            await expect(memorySystem.releaseResources())
                .rejects.toThrow();
        });
    });

    describe('Auto Cleanup', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should perform periodic cleanup', async () => {
            const cleanupSpy = jest.spyOn(memorySystem, 'performCleanup');

            memorySystem.setupAutoCleanup();
            jest.advanceTimersByTime(1500);  // Advance past cleanup interval

            expect(cleanupSpy).toHaveBeenCalled();
        });

        it('should handle cleanup errors', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockStorage.vacuum.mockRejectedValueOnce(new Error('Cleanup failed'));

            memorySystem.setupAutoCleanup();
            jest.advanceTimersByTime(1500);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });
});