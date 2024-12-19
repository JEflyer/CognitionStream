import { ChainUtil } from '../../modules/chain/utils/chainUtil';
import { setupTestEnvironment, cleanupTestEnvironment, createMockNode } from '../test-setup';

describe('ChainUtil', () => {
    beforeEach(() => {
        setupTestEnvironment();
    });

    afterEach(() => {
        cleanupTestEnvironment();
    });

    describe('hashChain', () => {
        it('should generate consistent hashes for identical chains', async () => {
            const chain1 = [
                createMockNode('1'),
                createMockNode('2', ['1'])
            ];
            const chain2 = [
                createMockNode('1'),
                createMockNode('2', ['1'])
            ];

            const hash1 = await ChainUtil.hashChain(chain1);
            const hash2 = await ChainUtil.hashChain(chain2);
            expect(hash1).toBe(hash2);
        });

        it('should generate different hashes for different chains', async () => {
            const chain1 = [{ id: '1', dependencies: ['2'] }];
            const chain2 = [{ id: '1', dependencies: ['3'] }];

            const hash1 = await ChainUtil.hashChain(chain1);
            const hash2 = await ChainUtil.hashChain(chain2);

            // Check if hashes are different strings rather than exact equality
            expect(hash1).not.toEqual(hash2);
        });

        it('should handle empty chains', async () => {
            const hash = await ChainUtil.hashChain([]);
            expect(typeof hash).toBe('string');
            expect(hash).toBeTruthy();
        });
    });

    describe('explorePath', () => {
        it('should find all valid paths in a graph', () => {
            const graph = new Map([
                ['1', { dependents: new Set(['2']), dependencies: [] }],
                ['2', { dependents: new Set(['3']), dependencies: ['1'] }],
                ['3', { dependents: new Set(), dependencies: ['2'] }]
            ]);

            const paths = ChainUtil.explorePath('1', graph);
            expect(paths).toContainEqual(['1', '2', '3']);
        });

        it('should handle branching paths', () => {
            const graph = new Map([
                ['1', { dependents: new Set(['2', '3']), dependencies: [] }],
                ['2', { dependents: new Set(['4']), dependencies: ['1'] }],
                ['3', { dependents: new Set(['4']), dependencies: ['1'] }],
                ['4', { dependents: new Set(), dependencies: ['2', '3'] }]
            ]);

            const paths = ChainUtil.explorePath('1', graph);

            // All paths should exist and be valid
            expect(paths.length).toBeGreaterThan(0);
            paths.forEach(path => {
                // Check path starts with root node
                expect(path[0]).toBe('1');
                // Path should be connected through dependencies
                for (let i = 1; i < path.length; i++) {
                    const node = graph.get(path[i]);
                    expect(node.dependencies).toContain(path[i - 1]);
                }
            });
        });

        it('should detect circular dependencies', () => {
            const graph = new Map([
                ['1', { dependents: new Set(['2']), dependencies: ['3'] }],
                ['2', { dependents: new Set(['3']), dependencies: ['1'] }],
                ['3', { dependents: new Set(['1']), dependencies: ['2'] }]
            ]);

            expect(() => ChainUtil.explorePath('1', graph))
                .toThrow('Circular dependency detected');
        });
    });

    describe('combinePaths', () => {
        it('should merge parallel and sequential paths', () => {
            const paths = [
                ['1', '2', '3'],
                ['4', '5'],
                ['1', '4', '6']
            ];

            const result = ChainUtil.combinePaths(paths);

            expect(result.parallel).toContain('1');
            expect(result.parallel).toContain('4');

            const sequentialMap = new Map(result.sequential);
            expect(sequentialMap.get('2')).toContain('1');
            expect(sequentialMap.get('3')).toContain('2');
        });

        it('should handle pre-optimized paths', () => {
            const optimizedPath = {
                parallel: ['1', '4'],
                sequential: [['2', ['1']], ['3', ['2']]]
            };

            const result = ChainUtil.combinePaths([optimizedPath]);

            expect(result.parallel).toContain('1');
            expect(result.parallel).toContain('4');

            const sequentialMap = new Map(result.sequential);
            expect(sequentialMap.get('2')).toContain('1');
            expect(sequentialMap.get('3')).toContain('2');
        });

        it('should handle empty inputs', () => {
            expect(ChainUtil.combinePaths([])).toEqual({
                parallel: [],
                sequential: []
            });
        });
    });
});