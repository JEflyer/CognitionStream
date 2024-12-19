import { EnhancedPatternOptimizer } from '../../modules/chain/optimizer';
import { setupTestEnvironment, cleanupTestEnvironment } from '../test-setup';

describe('EnhancedPatternOptimizer AI Integration', () => {
    let optimizer;
    let mockPerformanceTracker;
    let originalFetch;

    beforeEach(() => {
        setupTestEnvironment();
        mockPerformanceTracker = {
            getThought: jest.fn(id => ({
                id,
                type: 'test',
                execute: async () => `executed ${id}`
            })),
            getMetrics: jest.fn(() => ({
                executionTime: 100,
                memoryUsage: 50,
                cpuUsage: 0.5
            })),
            getThoughtMetrics: jest.fn()
        };
        optimizer = new EnhancedPatternOptimizer(mockPerformanceTracker);
        optimizer.aiConfig = {
            endpoint: 'https://api.example.com/optimize',
            apiKey: 'test-api-key',
            optimizerModel: 'test-model'
        };
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        cleanupTestEnvironment();
    });

    describe('AI-powered optimization', () => {
        it('should successfully use AI optimization when available', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'process', dependencies: ['1'] },
                { id: '3', type: 'end', dependencies: ['2'] }
            ];

            const mockAIOptimization = [
                { id: '1', type: 'start' },
                { id: '3', type: 'end', dependencies: ['1'] },
                { id: '2', type: 'process', dependencies: ['1', '3'] }
            ];

            global.fetch = jest.fn(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockAIOptimization)
            }));

            const result = await optimizer.optimizeChain(thoughtChain);

            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.example.com/optimize',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer test-api-key',
                        'Content-Type': 'application/json'
                    },
                    body: expect.any(String)
                })
            );

            expect(result).toBeDefined();
            expect(result).toHaveLength(3);
            expect(result[0].id).toBe('1');
        });

        it('should fall back to baseline optimization when AI fails', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'process', dependencies: ['1'] }
            ];

            global.fetch = jest.fn(() => Promise.reject(new Error('API Error')));

            const result = await optimizer.optimizeChain(thoughtChain);

            expect(global.fetch).toHaveBeenCalled();
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('1');
            expect(result[1].id).toBe('2');
        });

        it('should validate AI-optimized chain before using it', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'process', dependencies: ['1'] }
            ];

            const invalidAIOptimization = [
                { id: '1', type: 'start' },
                { id: '3', type: 'invalid', dependencies: ['1'] } // Invalid thought ID
            ];

            global.fetch = jest.fn(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve(invalidAIOptimization)
            }));

            const result = await optimizer.optimizeChain(thoughtChain);

            // Should fall back to baseline optimization
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('1');
            expect(result[1].id).toBe('2');
        });

        it('should merge AI and baseline optimizations effectively', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'process', dependencies: ['1'] },
                { id: '3', type: 'end', dependencies: ['2'] }
            ];

            const mockAIOptimization = [
                { id: '1', type: 'start' },
                { id: '2', type: 'process', dependencies: ['1'] },
                { id: '3', type: 'end', dependencies: ['1', '2'] }
            ];

            global.fetch = jest.fn(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockAIOptimization)
            }));

            mockPerformanceTracker.getMetrics.mockImplementation((thoughtId) => ({
                executionTime: thoughtId === '3' ? 50 : 100,
                memoryUsage: 50,
                cpuUsage: 0.5
            }));

            const result = await optimizer.optimizeChain(thoughtChain);

            expect(result).toBeDefined();
            expect(result).toHaveLength(3);
            // Verify the optimization preserved valid dependencies
            const finalThought = result.find(t => t.id === '3');
            expect(finalThought.dependencies).toContain('2');
        });

        it('should handle rate limiting and retry logic', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'end', dependencies: ['1'] }
            ];

            let attempts = 0;
            global.fetch = jest.fn(() => {
                attempts++;
                if (attempts === 1) {
                    return Promise.reject(new Error('Rate limited'));
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(thoughtChain)
                });
            });

            const result = await optimizer.optimizeChain(thoughtChain);

            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);
        });
    });

    describe('AI Configuration', () => {
        it('should skip AI optimization when no AI config is provided', async () => {
            optimizer.aiConfig = null;
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'end', dependencies: ['1'] }
            ];

            const result = await optimizer.optimizeChain(thoughtChain);

            expect(global.fetch).not.toHaveBeenCalled();
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);
        });

        it('should handle different AI optimization models', async () => {
            const thoughtChain = [
                { id: '1', type: 'start' },
                { id: '2', type: 'end', dependencies: ['1'] }
            ];

            optimizer.aiConfig.optimizerModel = 'advanced-model';

            global.fetch = jest.fn(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve(thoughtChain)
            }));

            await optimizer.optimizeChain(thoughtChain);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('advanced-model')
                })
            );
        });
    });
});