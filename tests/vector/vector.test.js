// tests/vector/vector.test.js
import { EnhancedVectorStore } from '../../modules/vector/vectorStore';
import { VectorIndex } from '../../modules/vector/vectorIndex';
import { VectorSimilarity } from '../../modules/vector/utils/similarity';
import { RandomProjectionTree } from '../../modules/vector/utils/projectionTree';
import { setupTestEnvironment, cleanupTestEnvironment } from '../test-setup';

describe('Vector System', () => {
    let vectorStore;
    let vectorIndex;
    let mockIndex;

    beforeEach(() => {
        setupTestEnvironment();
        
        // Setup mock index methods
        mockIndex = {
            add: jest.fn().mockResolvedValue(true),
            search: jest.fn().mockResolvedValue([]),
            delete: jest.fn().mockResolvedValue(true),
            maintenance: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockResolvedValue(true),
            vacuum: jest.fn().mockResolvedValue(true),
            getStats: jest.fn().mockResolvedValue({
                numVectors: 0,
                dimensions: 128
            })
        };

        // Create instances
        vectorStore = new EnhancedVectorStore();
        vectorStore.index = mockIndex;
        
        // Setup API config properly
        vectorStore.aiConfig = {
            endpoint: 'https://api.example.com',
            apiKey: 'test-key',
            modelName: 'test-model',
            compressionModel: 'test-compression'
        };

        vectorIndex = new VectorIndex(128);

        // Mock normalize function
        jest.spyOn(vectorStore, 'normalizeVector')
            .mockImplementation(vector => vector);

        // Mock vector validation
        jest.spyOn(vectorStore, 'validateVector')
            .mockImplementation(() => true);

        // Mock global fetch
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ embedding: Array(128).fill(0.1) })
        });
    });

    afterEach(async () => {
        try {
            if (vectorStore) {
                // Restore mocks before destroy
                jest.restoreAllMocks();
                await vectorStore.destroy().catch(() => {});
            }
            if (vectorIndex) await vectorIndex.destroy().catch(() => {});
        } catch (error) {
            // Ignore cleanup errors in tests
        }
        cleanupTestEnvironment();
    });

    describe('Vector Store Operations', () => {
        it('should add vectors correctly', async () => {
            const testVector = Array(128).fill(0.1);
            await vectorStore.add('test-key', testVector);
            expect(mockIndex.add).toHaveBeenCalledWith('test-key', testVector);
        });

        it('should delete vectors', async () => {
            await vectorStore.delete('test-key');
            expect(mockIndex.delete).toHaveBeenCalledWith('test-key');
        });

        it('should search for similar vectors', async () => {
            const queryVector = Array(128).fill(0.1);
            const mockResults = [
                { key: 'key1', similarity: 0.95 },
                { key: 'key2', similarity: 0.8 }
            ];

            mockIndex.search.mockResolvedValueOnce(mockResults);
            const results = await vectorStore.search(queryVector, 2, 0.5);
            
            expect(results).toEqual(mockResults);
            expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
        });

        it('should normalize vectors before storage', async () => {
            const vector = Array(128).fill(1);
            await vectorStore.add('test-key', vector);
            expect(vectorStore.normalizeVector).toHaveBeenCalledWith(vector);
        });

        it('should validate vector dimensions', async () => {
            vectorStore.validateVector.mockRestore();
            
            // We'll mock the implementation to actually check dimensions
            jest.spyOn(vectorStore, 'validateVector')
                .mockImplementation(vector => {
                    if (!Array.isArray(vector) || vector.length !== 128) {
                        throw new Error("Invalid vector dimensions");
                    }
                    return true;
                });

            const invalidVector = Array(64).fill(0.1);
            await expect(vectorStore.add('test-key', invalidVector))
                .rejects.toThrow("Invalid vector dimensions");
        });
    });

    describe('Vector Index Operations', () => {
        it('should maintain tree structure', async () => {
            const mockTree = {
                root: null,
                insert: jest.fn().mockResolvedValue(true),
                search: jest.fn().mockResolvedValue([]),
                delete: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
                maintenance: jest.fn().mockResolvedValue(true)
            };

            vectorIndex.trees = [mockTree];

            // Add test vectors
            const testVectors = Array(10).fill(null).map((_, i) => ({
                key: `key${i}`,
                vector: Array(128).fill(Math.random())
            }));

            for (const { key, vector } of testVectors) {
                await vectorIndex.add(key, vector);
            }

            expect(mockTree.insert).toHaveBeenCalledTimes(10);
        });

        it('should handle tree rebalancing', async () => {
            const mockTree = {
                root: null,
                insert: jest.fn().mockResolvedValue(true),
                needsRebalancing: jest.fn().mockReturnValue(true),
                rebuild: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true)
            };

            vectorIndex.trees = [mockTree];
            await vectorIndex.maintenance();

            expect(mockTree.rebuild).toHaveBeenCalled();
        });

        it('should perform approximate search', async () => {
            const mockResults = [
                { key: 'similar1', similarity: 0.95 },
                { key: 'similar2', similarity: 0.85 }
            ];

            const mockTree = {
                search: jest.fn().mockResolvedValue(mockResults),
                destroy: jest.fn().mockResolvedValue(true)
            };

            vectorIndex.trees = [mockTree];
            const queryVector = Array(128).fill(0.1);
            
            const results = await vectorIndex.search(queryVector, 2);
            expect(results).toEqual(mockResults);
        });
    });

    describe('AI Integration', () => {
        it('should generate embeddings via AI service', async () => {
            const embedding = await vectorStore.generateEmbedding('test text');
            expect(Array.isArray(embedding)).toBeTruthy();
            expect(embedding).toHaveLength(128);
            expect(global.fetch).toHaveBeenCalled();
        });

        it('should handle API service errors', async () => {
            global.fetch.mockRejectedValueOnce(new Error('API Error'));
            await expect(vectorStore.generateEmbedding('test text'))
                .rejects.toThrow('Embedding generation failed');
        });

        it('should retry on rate limits', async () => {
            global.fetch
                .mockRejectedValueOnce(new Error('Rate limited'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ embedding: Array(128).fill(0.1) })
                });

            const embedding = await vectorStore.generateEmbedding('test text');
            expect(embedding).toBeDefined();
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('Vector Similarity', () => {
        it('should calculate cosine similarity', () => {
            const v1 = [1, 0, 0, 0];
            const v2 = [1, 1, 0, 0];

            const similarity = VectorSimilarity.cosineSimilarity(v1, v2);
            expect(similarity).toBeCloseTo(0.7071, 4); // 1/√2
        });

        it('should calculate euclidean distance', () => {
            const v1 = [0, 0];
            const v2 = [3, 4];

            const distance = VectorSimilarity.euclideanDistance(v1, v2);
            expect(distance).toBe(5);
        });

        it('should handle zero vectors', () => {
            const v1 = [0, 0, 0, 0];
            const v2 = [1, 1, 1, 1];

            const similarity = VectorSimilarity.cosineSimilarity(v1, v2);
            expect(similarity).toBe(0);
        });

        it('should validate vector inputs', () => {
            const v1 = [1, 2, 3];
            const v2 = [1, 2];  // Different length

            expect(() => {
                VectorSimilarity.validateVectors(v1, v2);
            }).toThrow();
        });

        it('should handle NaN values', () => {
            const v1 = [1, NaN, 3];
            const v2 = [1, 2, 3];

            expect(() => {
                VectorSimilarity.validateVectors(v1, v2);
            }).toThrow();
        });
    });

    describe('System Maintenance', () => {
        it('should vacuum vector store', async () => {
            await vectorStore.vacuum();
            expect(mockIndex.maintenance).toHaveBeenCalled();
        });

        it('should track usage metrics', async () => {
            const metrics = await vectorStore.getUsageMetrics();
            expect(metrics).toHaveProperty('vectorCount');
            expect(metrics).toHaveProperty('dimensions');
        });

        it('should handle cleanup errors gracefully', async () => {
            mockIndex.destroy.mockRejectedValueOnce(new Error('Cleanup error'));
            await expect(vectorStore.destroy()).rejects.toThrow('Cleanup error');
        });

        it('should perform periodic maintenance', async () => {
            jest.useFakeTimers();
            
            const maintenanceSpy = jest.spyOn(vectorStore, 'vacuum');
            vectorStore.setupAutoMaintenance();
            
            jest.advanceTimersByTime(3600000); // 1 hour
            expect(maintenanceSpy).toHaveBeenCalled();
            
            jest.useRealTimers();
        });
    });

    describe('Error Handling', () => {
        it('should handle concurrent operations', async () => {
            const vector = Array(128).fill(0.1);
            const operations = [
                vectorStore.add('key1', vector),
                vectorStore.add('key2', vector),
                vectorStore.delete('key1'),
                vectorStore.add('key3', vector)
            ];

            await expect(Promise.all(operations))
                .resolves.toBeDefined();
        });

        it('should handle invalid inputs', async () => {
            vectorStore.validateVector.mockRestore();
            
            await expect(vectorStore.add('', Array(128).fill(0)))
                .rejects.toThrow();
            await expect(vectorStore.add('key', null))
                .rejects.toThrow();
            await expect(vectorStore.add('key', undefined))
                .rejects.toThrow();
            await expect(vectorStore.search(null))
                .rejects.toThrow();
        });

        it('should handle network errors', async () => {
            global.fetch.mockRejectedValueOnce(new Error('Network error'));
            await expect(vectorStore.generateEmbedding('test'))
                .rejects.toThrow();
        });

        it('should handle invalid API responses', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request'
            });
            
            await expect(vectorStore.generateEmbedding('test'))
                .rejects.toThrow();
        });
    });
});