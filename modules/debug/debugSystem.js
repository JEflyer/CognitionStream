import { AsyncLock } from '../concurrency';
import { MetricsCollector } from './metrics/collector';
import { ThoughtError } from '../errors/thoughtError';

class EnhancedDebugSystem {
    constructor(config = {}) {
        this.logs = new Map();
        this.breakpoints = new Set();
        this.metrics = new MetricsCollector();
        this.alertThresholds = config.alertThresholds || {
            memory: 0.8,    // 80% of available memory
            cpu: 0.9,       // 90% CPU usage
            time: 5000,     // 5 seconds
            errors: 10      // Number of errors per minute
        };
        this.monitoringIntervalId = null;
        this.errorCount = new Map(); // Track errors per minute
        this.debugHooks = new Map(); // Custom debug hooks
        this.setupMonitoring();
    }

    setupMonitoring() {
        if (this.monitoringIntervalId) {
            clearInterval(this.monitoringIntervalId);
        }
        this.monitoringIntervalId = setInterval(() => this.checkSystemHealth(), 5000);
    }

    async destroy() {
        try {
            if (this.monitoringIntervalId) {
                clearInterval(this.monitoringIntervalId);
                this.monitoringIntervalId = null;
            }
    
            try {
                await this.clearLogs();
            } catch (error) {
                console.error('Error clearing logs:', error);
                // Continue with cleanup despite log clearing error
            }
    
            this.breakpoints.clear();
            this.errorCount.clear();
            this.debugHooks.clear();
            
            return true;
        } catch (error) {
            console.error('Error during debug system destruction:', error);
            throw error;
        }
    }

    async checkSystemHealth() {
        try {
            const metrics = await this.metrics.collect();
            const alerts = [];

            // Check memory usage
            if (metrics.memory.heapUsedPercentage > this.alertThresholds.memory) {
                alerts.push({
                    type: 'MemoryAlert',
                    value: metrics.memory.heapUsedPercentage,
                    threshold: this.alertThresholds.memory,
                    timestamp: Date.now()
                });
            }

            // Check CPU usage
            if (metrics.cpu.percentage > this.alertThresholds.cpu) {
                alerts.push({
                    type: 'CPUAlert',
                    value: metrics.cpu.percentage,
                    threshold: this.alertThresholds.cpu,
                    timestamp: Date.now()
                });
            }

            // Clean up old error counts
            const oneMinuteAgo = Date.now() - 60000;
            for (const [key, value] of this.errorCount) {
                if (value.timestamp < oneMinuteAgo) {
                    this.errorCount.delete(key);
                }
            }

            if (alerts.length > 0) {
                this.handleAlerts(alerts);
            }

            // Store health check results
            this.logs.set('healthCheck', {
                timestamp: Date.now(),
                metrics,
                alerts
            });
        } catch (error) {
            this.log('error', 'Health check failed', { error: error.message });
        }
    }

    handleAlerts(alerts) {
        for (const alert of alerts) {
            this.log('alert', `System alert: ${alert.type}`, alert);

            // Execute any registered alert handlers
            const handler = this.debugHooks.get(alert.type);
            if (handler) {
                try {
                    handler(alert);
                } catch (error) {
                    this.log('error', 'Alert handler failed', {
                        alertType: alert.type,
                        error: error.message
                    });
                }
            }
        }
    }

    async inspectThought(thought) {
        const inspection = {
            id: thought.id,
            type: thought.type,
            timestamp: Date.now(),
            memory: await this.metrics.getMemoryProfile(thought),
            traces: await this.collectTraces(thought),
            resourceUsage: await this.metrics.getResourceUsage(thought),
            executionGraph: this.generateExecutionGraph(thought),
            dependencies: await this.analyzeDependencies(thought)
        };

        this.logs.set(`thought_${thought.id}`, inspection);
        return inspection;
    }

    async collectTraces(thought) {
        return {
            executionPath: this.captureExecutionPath(thought),
            functionCalls: await this.traceFunctionCalls(thought),
            resourceAccess: this.trackResourceAccess(thought),
            timing: this.measureExecutionTimes(thought)
        };
    }

    async traceFunctionCalls(thought) {
        const calls = [];
        const originalFunctions = new Map();
    
        // Store original functions and create proxies
        for (const key in thought) {
            if (typeof thought[key] === 'function' && key !== 'then') { // Exclude Promise methods
                originalFunctions.set(key, thought[key]);
                thought[key] = new Proxy(thought[key], {
                    apply: async (target, thisArg, args) => {
                        const start = performance.now();
                        const callInfo = {
                            function: key,
                            arguments: args.map(arg => this.sanitizeArg(arg)),
                            timestamp: Date.now()
                        };
    
                        try {
                            const result = await target.apply(thisArg, args);
                            callInfo.duration = performance.now() - start;
                            callInfo.status = 'success';
                            callInfo.result = this.sanitizeArg(result);
                            calls.push(callInfo); // Move this inside try block
                            return result;
                        } catch (error) {
                            callInfo.duration = performance.now() - start;
                            callInfo.status = 'error';
                            callInfo.error = error.message;
                            calls.push(callInfo); // Also track failed calls
                            throw error;
                        }
                    }
                });
            }
        }
    
        // Ensure function was actually called
        await thought.execute();
    
        // Restore original functions
        for (const [key, originalFn] of originalFunctions) {
            thought[key] = originalFn;
        }
    
        return calls;
    }

    sanitizeArg(arg) {
        // Safely stringify arguments and results for logging
        try {
            if (arg === undefined) return 'undefined';
            if (arg === null) return 'null';
            if (typeof arg === 'function') return 'function';
            if (typeof arg === 'object') {
                return JSON.stringify(arg, (key, value) => {
                    if (typeof value === 'function') return 'function';
                    if (value instanceof Error) return value.message;
                    return value;
                });
            }
            return String(arg);
        } catch (error) {
            return '[Complex Object]';
        }
    }

    captureExecutionPath(thought) {
        const path = [];
        let currentNode = thought;

        while (currentNode) {
            path.push({
                id: currentNode.id,
                type: currentNode.type,
                timestamp: currentNode.timestamp
            });
            currentNode = currentNode.parent;
        }

        return path;
    }

    trackResourceAccess(thought) {
        return {
            memory: this.getMemoryAccess(thought),
            storage: this.getStorageAccess(thought),
            network: this.getNetworkAccess(thought)
        };
    }

    measureExecutionTimes(thought) {
        return {
            total: 0,
            phases: [],
            bottlenecks: []
        };
    }

    log(level, message, context = {}) {
        const logEntry = {
            timestamp: Date.now(),
            level,
            message,
            context
        };

        // Store in logs map
        const key = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.logs.set(key, logEntry);

        // Trim old logs if necessary
        if (this.logs.size > 1000) { // Keep last 1000 logs
            const oldestKey = Array.from(this.logs.keys())[0];
            this.logs.delete(oldestKey);
        }

        return logEntry;
    }

    clearLogs() {
        this.logs.clear();
    }

    getLogsByLevel(level) {
        return Array.from(this.logs.values())
            .filter(entry => entry.level === level);
    }

    setBreakpoint(thoughtId, condition) {
        this.breakpoints.set(thoughtId, condition);
    }

    removeBreakpoint(thoughtId) {
        this.breakpoints.delete(thoughtId);
    }

    registerDebugHook(event, handler) {
        if (typeof handler !== 'function') {
            throw new Error('Debug hook handler must be a function');
        }
        this.debugHooks.set(event, handler);
    }

    getDebugSnapshot() {
        return {
            timestamp: Date.now(),
            logs: Array.from(this.logs.entries()),
            metrics: this.metrics.getLatestMetrics(),
            breakpoints: Array.from(this.breakpoints),
            errorCounts: Array.from(this.errorCount.entries())
        };
    }

    generateExecutionGraph(thought) {
        const graph = {
            nodes: [],
            edges: []
        };

        const visited = new Set();

        const addNode = (node) => {
            if (visited.has(node.id)) return;
            visited.add(node.id);

            graph.nodes.push({
                id: node.id,
                type: node.type,
                timestamp: node.timestamp
            });

            if (node.dependencies) {
                node.dependencies.forEach(depId => {
                    graph.edges.push({
                        from: depId,
                        to: node.id
                    });
                });
            }

            if (node.children) {
                node.children.forEach(child => {
                    addNode(child);
                    graph.edges.push({
                        from: node.id,
                        to: child.id
                    });
                });
            }
        };

        addNode(thought);
        return graph;
    }

    async analyzeDependencies(thought) {
        const dependencies = {
            direct: [],
            indirect: [],
            circular: []
        };

        const visited = new Set();
        const stack = new Set();

        const analyzeDep = async (node) => {
            if (stack.has(node.id)) {
                dependencies.circular.push(node.id);
                return;
            }

            if (visited.has(node.id)) return;

            stack.add(node.id);
            visited.add(node.id);

            if (node.dependencies) {
                for (const depId of node.dependencies) {
                    dependencies.direct.push({
                        from: node.id,
                        to: depId
                    });

                    const depNode = await this.getThought(depId);
                    if (depNode) {
                        await analyzeDep(depNode);
                    }
                }
            }

            stack.delete(node.id);
        };

        await analyzeDep(thought);
        return dependencies;
    }

    async getThought(thoughtId) {
        // Implementation would depend on how thoughts are stored/retrieved
        // This is a placeholder
        return null;
    }

    getMemoryAccess(thought) {
        return {
            reads: [],
            writes: [],
            allocations: []
        };
    }

    getStorageAccess(thought) {
        return {
            reads: [],
            writes: [],
            deletes: []
        };
    }

    getNetworkAccess(thought) {
        return {
            requests: [],
            responses: [],
            errors: []
        };
    }
}

export {EnhancedDebugSystem}