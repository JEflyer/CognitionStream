import { AsyncLock } from '../concurrency';
import { LRUCache } from '../memory/cache/lru';
import { ThoughtError } from '../errors/thoughtError';

class EnhancedPatternOptimizer {
    constructor(performanceTracker) {
        this.performanceTracker = performanceTracker;
        this.patterns = new Map();
        this.cache = new LRUCache(1000);
        this.learningRate = 0.1;

        // Add AI configuration
        this.aiConfig = {
            endpoint: null,
            apiKey: null,
            optimizerModel: null
        };
    }

    async optimizeChain(thoughtChain) {
        const chainHash = this.hashChain(thoughtChain);
        const cachedOptimization = this.cache.get(chainHash);

        if (cachedOptimization) {
            // Validate cached optimization
            try {
                await this.validateOptimization(cachedOptimization, thoughtChain);
                return cachedOptimization;
            } catch (error) {
                console.warn('Cached optimization invalid:', error);
                this.cache.delete(chainHash); // Remove invalid cache entry
            }
        }

        const optimizedChain = await this.analyzeAndOptimize(thoughtChain);
        this.cache.set(chainHash, optimizedChain);
        return optimizedChain;
    }

    async validateOptimization(optimization, originalChain) {
        // Ensure all thoughts exist
        const thoughtIds = new Set(originalChain.map(t => t.id));
        for (const thought of optimization) {
            if (!thoughtIds.has(thought.id)) {
                throw new Error(`Optimization references non-existent thought: ${thought.id}`);
            }
        }

        // Validate dependencies
        for (const thought of optimization) {
            if (thought.dependencies) {
                for (const depId of thought.dependencies) {
                    if (!thoughtIds.has(depId)) {
                        throw new Error(`Invalid dependency: ${depId} in thought ${thought.id}`);
                    }
                }
            }
        }

        // Ensure no circular dependencies
        this.checkForCircularDependencies(optimization);

        return true;
    }

    checkForCircularDependencies(chain) {
        const visited = new Set();
        const recursionStack = new Set();

        const dfs = (thoughtId) => {
            if (recursionStack.has(thoughtId)) {
                throw new Error(`Circular dependency detected: ${thoughtId}`);
            }
            if (visited.has(thoughtId)) {
                return;
            }

            visited.add(thoughtId);
            recursionStack.add(thoughtId);

            const thought = chain.find(t => t.id === thoughtId);
            if (thought && thought.dependencies) {
                for (const depId of thought.dependencies) {
                    dfs(depId);
                }
            }

            recursionStack.delete(thoughtId);
        };

        for (const thought of chain) {
            dfs(thought.id);
        }
    }

    async analyzeAndOptimize(thoughtChain) {
        // Add AI-powered optimization
        if (this.aiConfig.optimizerModel) {
            try {
                const response = await fetch(`${this.aiConfig.endpoint}/optimize`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.aiConfig.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        chain: thoughtChain,
                        model: this.aiConfig.optimizerModel
                    })
                });

                const aiOptimization = await response.json();
                return this.mergeWithBaselineOptimization(
                    aiOptimization,
                    await this.baselineOptimization(thoughtChain)
                );
            } catch (error) {
                console.error('AI optimization failed, using baseline:', error);
            }
        }

        // Fallback to existing optimization logic
        return this.baselineOptimization(thoughtChain);
    }

    async baselineOptimization(thoughtChain) {
        try {
            // Build dependency graph
            const graph = this.buildDependencyGraph(thoughtChain);
            
            // Find all possible execution paths
            const paths = this.findExecutionPaths(graph);
            
            // Optimize each path
            const optimizedPaths = await Promise.all(
                paths.map(path => this.optimizePath(path))
            );

            // Analyze metrics for each optimized path
            const pathMetrics = await Promise.all(
                optimizedPaths.map(async path => ({
                    path,
                    metrics: await this.calculatePathMetrics(path)
                }))
            );

            // Select best path based on metrics
            const bestPath = this.selectOptimalPath(pathMetrics);
            
            // Apply performance patterns
            const patternOptimizedPath = await this.applyPerformancePatterns(bestPath);
            
            // Validate final optimization
            await this.validateOptimization(patternOptimizedPath, thoughtChain);
            
            return patternOptimizedPath;
        } catch (error) {
            console.error('Baseline optimization failed:', error);
            // Return original chain if optimization fails
            return thoughtChain;
        }
    }

    buildDependencyGraph(thoughtChain) {
        const graph = new Map();

        thoughtChain.forEach(thought => {
            graph.set(thought.id, {
                thought,
                dependencies: new Set(thought.dependencies || []),
                dependents: new Set()
            });
        });

        // Build reverse dependencies
        thoughtChain.forEach(thought => {
            (thought.dependencies || []).forEach(depId => {
                const node = graph.get(depId);
                if (node) {
                    node.dependents.add(thought.id);
                }
            });
        });

        return graph;
    }

    findExecutionPaths(graph) {
        const paths = [];
        const visited = new Set();

        // Find root nodes (nodes with no dependencies)
        const roots = Array.from(graph.entries())
            .filter(([_, node]) => node.dependencies.size === 0)
            .map(([id]) => id);

        // DFS from each root
        roots.forEach(root => {
            const path = this.explorePath(root, graph, visited, new Set());
            if (path.length > 0) {
                paths.push(path);
            }
        });

        return paths;
    }

    async optimizePath(path) {
        const optimizedPath = [];
        let currentBatch = [];

        for (const thoughtId of path) {
            const thought = this.getThought(thoughtId);
            const metrics = await this.analyzeThought(thought);

            // Check if thought can be batched
            if (this.canBatch(thought, currentBatch, metrics)) {
                currentBatch.push(thought);
            } else {
                if (currentBatch.length > 0) {
                    optimizedPath.push(this.createBatch(currentBatch));
                    currentBatch = [thought];
                } else {
                    optimizedPath.push(thought);
                }
            }
        }

        // Handle remaining batch
        if (currentBatch.length > 0) {
            optimizedPath.push(this.createBatch(currentBatch));
        }

        return optimizedPath;
    }

    canBatch(thought, batch, metrics) {
        if (batch.length === 0) return true;

        // Check resource usage
        const batchMetrics = batch.map(t => this.getThoughtMetrics(t.id));
        const totalResources = this.calculateTotalResources(batchMetrics);

        // Check if adding this thought would exceed resource limits
        return this.checkResourceLimits(totalResources, metrics);
    }

    createBatch(thoughts) {
        return {
            id: `batch_${thoughts.map(t => t.id).join('_')}`,
            type: 'batch',
            thoughts: thoughts,
            execute: async (context) => {
                return Promise.all(thoughts.map(t => t.execute(context)));
            }
        };
    }

    checkResourceLimits(currentTotal, newMetrics) {
        // Implement resource limit checks
        const limits = {
            memory: 1000000000, // 1GB
            cpu: 0.8, // 80% CPU
            time: 1000 // 1 second
        };

        return Object.entries(limits).every(([resource, limit]) => {
            return (currentTotal[resource] || 0) + (newMetrics[resource] || 0) <= limit;
        });
    }

    async calculatePathMetrics(path) {
        const metrics = {
            totalExecutionTime: 0,
            peakMemoryUsage: 0,
            cpuUtilization: 0,
            resourceEfficiency: 0
        };

        for (const thought of path) {
            const thoughtMetrics = await this.analyzeThought(thought);
            metrics.totalExecutionTime += thoughtMetrics.executionTime || 0;
            metrics.peakMemoryUsage = Math.max(metrics.peakMemoryUsage, thoughtMetrics.memoryUsage || 0);
            metrics.cpuUtilization = Math.max(metrics.cpuUtilization, thoughtMetrics.cpuUsage || 0);
        }

        // Calculate resource efficiency score
        metrics.resourceEfficiency = this.calculateEfficiencyScore(metrics);
        return metrics;
    }

    calculateEfficiencyScore(metrics) {
        const weights = {
            executionTime: 0.4,
            memoryUsage: 0.3,
            cpuUtilization: 0.3
        };

        return (
            (1 / (metrics.totalExecutionTime + 1)) * weights.executionTime +
            (1 / (metrics.peakMemoryUsage + 1)) * weights.memoryUsage +
            (1 / (metrics.cpuUtilization + 1)) * weights.cpuUtilization
        );
    }

    selectOptimalPath(pathMetrics) {
        return pathMetrics.reduce((best, current) => {
            if (!best || current.metrics.resourceEfficiency > best.metrics.resourceEfficiency) {
                return current;
            }
            return best;
        }).path;
    }

    async applyPerformancePatterns(path) {
        const optimizedPath = [...path];
        
        // Apply known optimization patterns
        for (const [patternName, pattern] of this.patterns) {
            try {
                const patternResult = await pattern.apply(optimizedPath);
                if (patternResult.improved) {
                    optimizedPath.splice(0, optimizedPath.length, ...patternResult.path);
                }
            } catch (error) {
                console.error(`Failed to apply pattern ${patternName}:`, error);
            }
        }

        return optimizedPath;
    }

    async hashChain(thoughtChain) {
        const chainData = thoughtChain.map(t => ({
            id: t.id,
            dependencies: t.dependencies || []
        }));
        
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(chainData));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async getThought(thoughtId) {
        // Implementation would depend on how thoughts are stored
        // This is a placeholder that should be implemented based on the actual storage mechanism
        return this.performanceTracker.getThought(thoughtId);
    }

    async analyzeThought(thought) {
        // This would be implemented based on the actual metrics collection system
        return this.performanceTracker.getMetrics(thought.id);
    }

    calculateTotalResources(metrics) {
        return metrics.reduce((total, metric) => {
            Object.entries(metric).forEach(([key, value]) => {
                total[key] = (total[key] || 0) + value;
            });
            return total;
        }, {});
    }

    async getThoughtMetrics(thoughtId) {
        // This would be implemented based on the actual metrics collection system
        return this.performanceTracker.getThoughtMetrics(thoughtId);
    }
}