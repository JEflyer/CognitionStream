import { EnhancedDebugSystem } from '../../modules/debug/debugSystem';
import { setupTestEnvironment, cleanupTestEnvironment, delay } from '../test-setup';

describe('EnhancedDebugSystem', () => {
    let debugSystem;
    
    beforeEach(() => {
        setupTestEnvironment();
        debugSystem = new EnhancedDebugSystem({
            alertThresholds: {
                memory: 0.8,
                cpu: 0.9,
                time: 5000,
                errors: 10
            }
        });
    });

    afterEach(async () => {
        if (debugSystem) {
            await debugSystem.destroy();
        }
        cleanupTestEnvironment();
    });

    describe('System Health Monitoring', () => {
        it('should detect memory alerts', async () => {
            const alerts = [];
            debugSystem.registerDebugHook('MemoryAlert', (alert) => {
                alerts.push(alert);
            });

            // Mock metrics collection to trigger memory alert
            jest.spyOn(debugSystem.metrics, 'collect').mockResolvedValue({
                memory: {
                    heapUsedPercentage: 0.85 // Above threshold
                },
                cpu: {
                    percentage: 0.5
                }
            });

            await debugSystem.checkSystemHealth();
            expect(alerts.length).toBe(1);
            expect(alerts[0].type).toBe('MemoryAlert');
            expect(alerts[0].value).toBe(0.85);
        });

        it('should detect CPU alerts', async () => {
            const alerts = [];
            debugSystem.registerDebugHook('CPUAlert', (alert) => {
                alerts.push(alert);
            });

            // Mock metrics collection to trigger CPU alert
            jest.spyOn(debugSystem.metrics, 'collect').mockResolvedValue({
                memory: {
                    heapUsedPercentage: 0.5
                },
                cpu: {
                    percentage: 0.95 // Above threshold
                }
            });

            await debugSystem.checkSystemHealth();
            expect(alerts.length).toBe(1);
            expect(alerts[0].type).toBe('CPUAlert');
            expect(alerts[0].value).toBe(0.95);
        });
    });

    describe('Logging System', () => {
        it('should properly log messages with different levels', () => {
            debugSystem.log('info', 'Test info message');
            debugSystem.log('error', 'Test error message', { error: 'details' });
            debugSystem.log('warn', 'Test warning message');

            const logs = Array.from(debugSystem.logs.values());
            expect(logs.length).toBe(3);
            expect(logs.find(log => log.level === 'error').context.error).toBe('details');
        });

        it('should maintain log history within limits', () => {
            // Add more than 1000 logs
            for (let i = 0; i < 1100; i++) {
                debugSystem.log('info', `Log message ${i}`);
            }

            expect(debugSystem.logs.size).toBeLessThanOrEqual(1000);
        });

        it('should retrieve logs by level', () => {
            debugSystem.log('error', 'Error 1');
            debugSystem.log('info', 'Info 1');
            debugSystem.log('error', 'Error 2');

            const errorLogs = debugSystem.getLogsByLevel('error');
            expect(errorLogs.length).toBe(2);
            expect(errorLogs[0].message).toBe('Error 1');
            expect(errorLogs[1].message).toBe('Error 2');
        });
    });

    describe('Thought Inspection', () => {
        it('should inspect thought execution details', async () => {
            const thought = {
                id: 'test-thought',
                type: 'test',
                dependencies: ['dep1', 'dep2'],
                execute: async () => 'result'
            };

            const inspection = await debugSystem.inspectThought(thought);
            
            expect(inspection.id).toBe('test-thought');
            expect(inspection.type).toBe('test');
            expect(inspection.traces).toBeDefined();
            expect(inspection.executionGraph).toBeDefined();
            expect(inspection.dependencies).toBeDefined();
        });

        it('should track function calls during thought execution', async () => {
            const thought = {
                id: 'test-thought',
                testFunction: async (arg) => `processed ${arg}`,
                execute: async () => {
                    await thought.testFunction('input');
                    return 'done';
                }
            };

            const traces = await debugSystem.collectTraces(thought);
            expect(traces.functionCalls.length).toBeGreaterThan(0);
        });

        it('should generate execution graph', () => {
            const thought = {
                id: 'root',
                type: 'test',
                children: [
                    { id: 'child1', type: 'test' },
                    { id: 'child2', type: 'test' }
                ]
            };

            const graph = debugSystem.generateExecutionGraph(thought);
            expect(graph.nodes.length).toBe(3);
            expect(graph.edges.length).toBe(2);
        });
    });

    describe('Resource Tracking', () => {
        it('should track memory access patterns', () => {
            const thought = {
                id: 'test-thought',
                execute: () => {
                    // Simulate memory operations
                    const array = new Array(1000);
                    return array;
                }
            };

            const memoryAccess = debugSystem.getMemoryAccess(thought);
            expect(memoryAccess.allocations).toBeDefined();
            expect(memoryAccess.reads).toBeDefined();
            expect(memoryAccess.writes).toBeDefined();
        });

        it('should track network access', () => {
            const thought = {
                id: 'test-thought',
                execute: async () => {
                    // Simulate network call
                    await fetch('https://api.example.com');
                    return 'done';
                }
            };

            const networkAccess = debugSystem.getNetworkAccess(thought);
            expect(networkAccess.requests).toBeDefined();
            expect(networkAccess.responses).toBeDefined();
            expect(networkAccess.errors).toBeDefined();
        });
    });

    describe('Debug Hooks', () => {
        it('should register and execute debug hooks', async () => {
            const hookExecuted = jest.fn();
            debugSystem.registerDebugHook('TestEvent', hookExecuted);

            const alert = {
                type: 'TestEvent',
                value: 0.9,
                timestamp: Date.now()
            };

            debugSystem.handleAlerts([alert]);
            expect(hookExecuted).toHaveBeenCalledWith(alert);
        });

        it('should handle cleanup errors gracefully', async () => {
            jest.spyOn(debugSystem, 'clearLogs').mockImplementation(() => {
                throw new Error('Cleanup error');
            });
        
            const logSpy = jest.spyOn(console, 'error');
            await debugSystem.destroy();
        
            expect(logSpy).toHaveBeenCalledWith('Error clearing logs:', expect.any(Error));
            expect(debugSystem.monitoringIntervalId).toBeNull();
            expect(debugSystem.breakpoints.size).toBe(0);
            expect(debugSystem.errorCount.size).toBe(0);
            expect(debugSystem.debugHooks.size).toBe(0);
        });
    });

    describe('System Cleanup', () => {
        it('should properly clean up resources on destroy', async () => {
            const clearLogsSpy = jest.spyOn(debugSystem, 'clearLogs');
            await debugSystem.destroy();

            expect(clearLogsSpy).toHaveBeenCalled();
            expect(debugSystem.breakpoints.size).toBe(0);
            expect(debugSystem.errorCount.size).toBe(0);
            expect(debugSystem.debugHooks.size).toBe(0);
            expect(debugSystem.monitoringIntervalId).toBeNull();
        });

        it('should handle cleanup errors gracefully', async () => {
            jest.spyOn(debugSystem, 'clearLogs').mockImplementation(() => {
                throw new Error('Cleanup error');
            });

            const logSpy = jest.spyOn(console, 'error');
            await debugSystem.destroy();

            expect(logSpy).toHaveBeenCalled();
        });
    });

    describe('Debug Snapshot', () => {
        it('should create accurate system snapshot', () => {
            // Add some test data
            debugSystem.log('info', 'Test log');
            debugSystem.breakpoints.add('test-breakpoint');
            debugSystem.errorCount.set('test-error', { count: 1, timestamp: Date.now() });

            const snapshot = debugSystem.getDebugSnapshot();
            
            expect(snapshot.timestamp).toBeDefined();
            expect(snapshot.logs.length).toBeGreaterThan(0);
            expect(snapshot.breakpoints).toContain('test-breakpoint');
            expect(snapshot.errorCounts.length).toBeGreaterThan(0);
            expect(snapshot.metrics).toBeDefined();
        });
    });
});