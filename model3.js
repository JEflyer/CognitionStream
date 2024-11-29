// Enhanced Memory Management System
class EnhancedMemorySystem {
    constructor(config = {}) {
        this.shortTermMemory = new Map();
        this.workingMemory = new LRUCache(config.workingMemorySize || 1000);
        this.vectorStore = new EnhancedVectorStore();
        this.memoryLimits = {
            shortTerm: config.shortTermLimit || 10000,
            working: config.workingMemoryLimit || 5000,
            vector: config.vectorLimit || 100000
        };
        this.cleanupInterval = config.cleanupInterval || 3600000; // 1 hour
        this.setupAutoCleanup();
    }

    setupAutoCleanup() {
        setInterval(() => this.performCleanup(), this.cleanupInterval);
    }

    async performCleanup() {
        const now = Date.now();
        // Cleanup short-term memory
        for (const [key, value] of this.shortTermMemory) {
            if (now - value.metadata.timestamp > this.memoryLimits.shortTerm) {
                this.shortTermMemory.delete(key);
            }
        }
        // Trigger vacuum on vector store
        await this.vectorStore.vacuum();
    }

    async store(key, data, type = 'shortTerm', metadata = {}) {
        const timestamp = Date.now();
        const enhancedMetadata = {
            ...metadata,
            timestamp,
            type,
            size: this.calculateSize(data)
        };

        // Check memory limits before storing
        if (!this.checkMemoryLimits(type, enhancedMetadata.size)) {
            throw new ThoughtError(
                'MemoryLimitExceeded',
                `Memory limit exceeded for ${type}`,
                { size: enhancedMetadata.size, limit: this.memoryLimits[type] }
            );
        }

        switch(type) {
            case 'shortTerm':
                this.shortTermMemory.set(key, { 
                    data: await this.compress(data), 
                    metadata: enhancedMetadata 
                });
                break;
            case 'working':
                this.workingMemory.set(key, { 
                    data: await this.compress(data), 
                    metadata: enhancedMetadata 
                });
                break;
            case 'vector':
                const embedding = await this.vectorStore.generateEmbedding(data);
                await this.vectorStore.store(key, data, embedding, enhancedMetadata);
                break;
        }

        return enhancedMetadata;
    }

    async compress(data) {
        // Implement actual compression logic here
        return data;
    }

    async decompress(data, metadata) {
        // Implement actual decompression logic here
        return data;
    }

    calculateSize(data) {
        return JSON.stringify(data).length;
    }

    checkMemoryLimits(type, size) {
        return size <= this.memoryLimits[type];
    }

    async getUsageMetrics() {
        return {
            shortTerm: {
                size: this.shortTermMemory.size,
                capacityUsed: this.shortTermMemory.size / this.memoryLimits.shortTerm
            },
            working: {
                size: this.workingMemory.size(),
                capacityUsed: this.workingMemory.size() / this.memoryLimits.working
            },
            vector: await this.vectorStore.getUsageMetrics(),
            lastCleanup: this.lastCleanupTime,
            totalEntries: this.shortTermMemory.size + 
                         this.workingMemory.size() + 
                         await this.vectorStore.getEntryCount()
        };
    }
}

// Enhanced Vector Store with improved similarity search
class EnhancedVectorStore {
    constructor() {
        this.store = new Map();
        this.index = new VectorIndex();
        this.deletedKeys = new Set();
    }

    async generateEmbedding(data) {
        // Implement real embedding generation using a proper ML model
        // This is a placeholder that should be replaced with actual embedding logic
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return new Float32Array(hash);
    }

    async store(key, data, embedding, metadata) {
        const entry = { data, embedding, metadata };
        this.store.set(key, entry);
        await this.index.add(key, embedding);
    }

    async search(queryEmbedding, limit = 5, filters = {}) {
        // Get candidate keys from index
        const candidateKeys = await this.index.search(queryEmbedding, limit * 2);
        
        // Apply filters and calculate exact similarities
        const results = await Promise.all(
            candidateKeys.map(async key => {
                const entry = this.store.get(key);
                if (!entry || this.deletedKeys.has(key)) return null;
                
                // Apply filters
                if (!this.matchesFilters(entry, filters)) return null;
                
                const similarity = await this.calculateSimilarity(queryEmbedding, entry.embedding);
                return { key, similarity, data: entry.data, metadata: entry.metadata };
            })
        );

        // Remove nulls and sort by similarity
        return results
            .filter(result => result !== null)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    async calculateSimilarity(embedding1, embedding2) {
        // Implement multiple similarity metrics
        const cosine = this.cosineSimilarity(embedding1, embedding2);
        const euclidean = this.euclideanDistance(embedding1, embedding2);
        const manhattan = this.manhattanDistance(embedding1, embedding2);
        
        // Combine metrics with weights
        return (cosine * 0.6) + (1 - euclidean * 0.25) + (1 - manhattan * 0.15);
    }

    matchesFilters(entry, filters) {
        return Object.entries(filters).every(([key, value]) => {
            if (key in entry.metadata) {
                if (typeof value === 'function') {
                    return value(entry.metadata[key]);
                }
                return entry.metadata[key] === value;
            }
            return false;
        });
    }

    async vacuum() {
        // Remove deleted entries and rebuild index if necessary
        if (this.deletedKeys.size > this.store.size * 0.2) {
            const newStore = new Map();
            const newIndex = new VectorIndex();
            
            for (const [key, entry] of this.store) {
                if (!this.deletedKeys.has(key)) {
                    newStore.set(key, entry);
                    await newIndex.add(key, entry.embedding);
                }
            }
            
            this.store = newStore;
            this.index = newIndex;
            this.deletedKeys.clear();
        }
    }
}

// Vector Index for faster similarity search
class VectorIndex {
    constructor(dimensions = 128, numTrees = 10) {
        this.dimensions = dimensions;
        this.numTrees = numTrees;
        this.trees = Array.from({ length: numTrees }, () => new RandomProjectionTree());
    }

    async add(key, embedding) {
        for (const tree of this.trees) {
            await tree.insert(key, embedding);
        }
    }

    async search(queryEmbedding, limit) {
        const results = new Map();
        
        // Search in all trees
        await Promise.all(this.trees.map(async tree => {
            const treeResults = await tree.search(queryEmbedding, limit);
            treeResults.forEach(key => {
                results.set(key, (results.get(key) || 0) + 1);
            });
        }));

        // Sort by frequency of appearance in trees
        return Array.from(results.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([key]) => key)
            .slice(0, limit);
    }
}

// Enhanced Pattern Optimizer with improved parallelization
class EnhancedPatternOptimizer {
    constructor(performanceTracker) {
        this.performanceTracker = performanceTracker;
        this.patterns = new Map();
        this.cache = new LRUCache(1000);
        this.learningRate = 0.1;
    }

    async optimizeChain(thoughtChain) {
        const chainHash = this.hashChain(thoughtChain);
        const cachedOptimization = this.cache.get(chainHash);
        
        if (cachedOptimization) {
            return cachedOptimization;
        }

        const optimizedChain = await this.analyzeAndOptimize(thoughtChain);
        this.cache.set(chainHash, optimizedChain);
        
        return optimizedChain;
    }

    async analyzeAndOptimize(thoughtChain) {
        // Build dependency graph
        const graph = this.buildDependencyGraph(thoughtChain);
        
        // Find optimal execution paths
        const paths = this.findExecutionPaths(graph);
        
        // Optimize each path
        const optimizedPaths = await Promise.all(
            paths.map(path => this.optimizePath(path))
        );

        // Combine optimized paths
        return this.combinePaths(optimizedPaths);
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
}

// Enhanced Debug System with advanced monitoring
class EnhancedDebugSystem {
    constructor(config = {}) {
        this.logs = new Map();
        this.breakpoints = new Set();
        this.metrics = new MetricsCollector();
        this.alertThresholds = config.alertThresholds || {
            memory: 0.8, // 80% of available memory
            cpu: 0.9,    // 90% CPU usage
            time: 5000   // 5 seconds
        };
        this.setupMonitoring();
    }

    setupMonitoring() {
        // Monitor system resources
        setInterval(() => this.checkSystemHealth(), 5000);
    }

    async checkSystemHealth() {
        const metrics = await this.metrics.collect();
        
        // Check against thresholds
        Object.entries(this.alertThresholds).forEach(([metric, threshold]) => {
            if (metrics[metric] > threshold) {
                this.raiseAlert(metric, metrics[metric]);
            }
        });
    }

    raiseAlert(metric, value) {
        const alert = {
            type: 'ResourceAlert',
            metric,
            value,
            timestamp: Date.now(),
            severity: this.calculateSeverity(metric, value)
        };

        this.log('system', 'ALERT', `Resource alert: ${metric}`, alert);
    }

    calculateSeverity(metric, value) {
        const threshold = this.alertThresholds[metric];
        const ratio = value / threshold;
        
        if (ratio > 1.5) return 'CRITICAL';
        if (ratio > 1.2) return 'HIGH';
        if (ratio > 1.0) return 'MEDIUM';
        return 'LOW';
    }

    async inspectThought(thought) {
        const inspection = await super.inspectThought(thought);
        
        // Enhanced inspection
        inspection.memory = await this.metrics.getMemoryProfile(thought);
        inspection.traces = await this.collectTraces(thought);
        inspection.resourceUsage = await this.metrics.getResourceUsage(thought);
        
        return inspection;
    }

    async collectTraces(thought) {
        // Implement actual tracing logic
        return {
            executionPath: [],
            functionCalls: [],
            resourceAccess: [],
            timing: {}
        };
    }
}

// Metrics Collector for enhanced monitoring
class MetricsCollector {
    constructor() {
        this.networkBaseline = {
            bytesIn: 0,
            bytesOut: 0,
            connections: 0,
            lastUpdate: Date.now()
        };
        this.diskBaseline = {
            reads: 0,
            writes: 0,
            lastUpdate: Date.now()
        };
        this.metricsHistory = new Map();
        this.historyLimit = 1000;
    }

    async collect() {
        const metrics = {
            memory: await this.collectMemoryMetrics(),
            cpu: await this.collectCPUMetrics(),
            network: await this.collectNetworkMetrics(),
            disk: await this.collectDiskMetrics(),
            timestamp: Date.now()
        };

        this.storeMetricsHistory(metrics);
        return metrics;
    }

    async collectMemoryMetrics() {
        const usage = process.memoryUsage();
        return {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            rss: usage.rss,
            heapUsedPercentage: (usage.heapUsed / usage.heapTotal) * 100,
            gcMetrics: await this.getGCMetrics()
        };
    }

    async collectCPUMetrics() {
        const startUsage = process.cpuUsage();
        await new Promise(resolve => setTimeout(resolve, 100));
        const endUsage = process.cpuUsage(startUsage);
        
        return {
            user: endUsage.user,
            system: endUsage.system,
            percentage: (endUsage.user + endUsage.system) / 1000000,
            loadAverage: this.getLoadAverage()
        };
    }

    async collectNetworkMetrics() {
        // Simulate network stats collection
        const currentStats = await this.getNetworkStats();
        const timeDiff = (Date.now() - this.networkBaseline.lastUpdate) / 1000; // Convert to seconds
        
        const metrics = {
            bytesInPerSec: (currentStats.bytesIn - this.networkBaseline.bytesIn) / timeDiff,
            bytesOutPerSec: (currentStats.bytesOut - this.networkBaseline.bytesOut) / timeDiff,
            activeConnections: currentStats.connections,
            connectionRate: (currentStats.connections - this.networkBaseline.connections) / timeDiff,
            latency: await this.measureNetworkLatency()
        };

        // Update baseline
        this.networkBaseline = {
            ...currentStats,
            lastUpdate: Date.now()
        };

        return metrics;
    }

    async collectDiskMetrics() {
        // Simulate disk stats collection
        const currentStats = await this.getDiskStats();
        const timeDiff = (Date.now() - this.diskBaseline.lastUpdate) / 1000;

        const metrics = {
            readsPerSec: (currentStats.reads - this.diskBaseline.reads) / timeDiff,
            writesPerSec: (currentStats.writes - this.diskBaseline.writes) / timeDiff,
            freeSpace: await this.getDiskFreeSpace(),
            iops: await this.calculateIOPS(),
            latency: await this.measureDiskLatency()
        };

        // Update baseline
        this.diskBaseline = {
            ...currentStats,
            lastUpdate: Date.now()
        };

        return metrics;
    }

    async getGCMetrics() {
        // This would require integration with Node.js GC hooks
        // Placeholder for actual GC metrics
        return {
            minorGCs: 0,
            majorGCs: 0,
            totalGCPauseTime: 0,
            averageGCPause: 0
        };
    }

    getLoadAverage() {
        const [oneMin, fiveMin, fifteenMin] = process.loadavg();
        return { oneMin, fiveMin, fifteenMin };
    }

    async getNetworkStats() {
        // Placeholder for actual network stats collection
        return {
            bytesIn: Math.floor(Math.random() * 1000000),
            bytesOut: Math.floor(Math.random() * 1000000),
            connections: Math.floor(Math.random() * 100)
        };
    }

    async getDiskStats() {
        // Placeholder for actual disk stats collection
        return {
            reads: Math.floor(Math.random() * 10000),
            writes: Math.floor(Math.random() * 10000)
        };
    }

    async getDiskFreeSpace() {
        // Placeholder for actual disk space check
        return {
            total: 1000000000000, // 1 TB
            free: 700000000000,   // 700 GB
            used: 300000000000    // 300 GB
        };
    }

    async calculateIOPS() {
        // Placeholder for actual IOPS calculation
        return {
            read: Math.floor(Math.random() * 1000),
            write: Math.floor(Math.random() * 1000)
        };
    }

    async measureNetworkLatency() {
        // Placeholder for actual network latency measurement
        return {
            min: Math.random() * 10,
            max: Math.random() * 100 + 50,
            avg: Math.random() * 50 + 25
        };
    }

    async measureDiskLatency() {
        // Placeholder for actual disk latency measurement
        return {
            read: Math.random() * 5,
            write: Math.random() * 10
        };
    }

    storeMetricsHistory(metrics) {
        const timestamp = metrics.timestamp;
        this.metricsHistory.set(timestamp, metrics);

        // Remove old entries if we exceed the history limit
        if (this.metricsHistory.size > this.historyLimit) {
            const oldestKey = Array.from(this.metricsHistory.keys())[0];
            this.metricsHistory.delete(oldestKey);
        }
    }

    getMetricsHistory(duration) {
        const now = Date.now();
        const threshold = now - duration;
        
        return Array.from(this.metricsHistory.entries())
            .filter(([timestamp]) => timestamp >= threshold)
            .map(([_, metrics]) => metrics);
    }

    calculateTrends(duration = 3600000) { // Default to last hour
        const history = this.getMetricsHistory(duration);
        if (history.length < 2) return null;

        const trends = {
            memory: this.calculateMetricTrend(history, 'memory'),
            cpu: this.calculateMetricTrend(history, 'cpu'),
            network: this.calculateMetricTrend(history, 'network'),
            disk: this.calculateMetricTrend(history, 'disk')
        };

        return trends;
    }

    calculateMetricTrend(history, metricType) {
        const values = history.map(h => h[metricType]);
        const timestamps = history.map(h => h.timestamp);

        // Calculate rate of change
        const firstValue = values[0];
        const lastValue = values[values.length - 1];
        const timespan = timestamps[timestamps.length - 1] - timestamps[0];
        
        return {
            change: lastValue - firstValue,
            changeRate: (lastValue - firstValue) / timespan,
            trend: this.determineTrend(values)
        };
    }

    determineTrend(values) {
        if (values.length < 2) return 'stable';
        
        const changes = values.slice(1).map((val, i) => val - values[i]);
        const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
        
        if (Math.abs(avgChange) < 0.1) return 'stable';
        return avgChange > 0 ? 'increasing' : 'decreasing';
    }
}

// Random Projection Tree Implementation
class RandomProjectionTree {
    constructor(dimensions = 128, maxLeafSize = 10) {
        this.dimensions = dimensions;
        this.maxLeafSize = maxLeafSize;
        this.root = this.createNode();
    }

    createNode() {
        return {
            isLeaf: true,
            points: new Map(), // key -> embedding
            splitPlane: null,
            left: null,
            right: null
        };
    }

    async insert(key, embedding) {
        await this.insertAtNode(this.root, key, embedding);
    }

    async insertAtNode(node, key, embedding) {
        if (node.isLeaf) {
            node.points.set(key, embedding);
            
            // Split if too many points
            if (node.points.size > this.maxLeafSize) {
                await this.splitNode(node);
            }
            return;
        }

        // Non-leaf node: traverse to appropriate child
        const projection = this.project(embedding, node.splitPlane);
        const nextNode = projection <= 0 ? node.left : node.right;
        await this.insertAtNode(nextNode, key, embedding);
    }

    async splitNode(node) {
        // Generate random splitting plane
        node.splitPlane = this.generateRandomPlane();
        node.left = this.createNode();
        node.right = this.createNode();
        node.isLeaf = false;

        // Redistribute points
        for (const [key, embedding] of node.points) {
            const projection = this.project(embedding, node.splitPlane);
            const targetNode = projection <= 0 ? node.left : node.right;
            targetNode.points.set(key, embedding);
        }

        // Clear points from this node
        node.points.clear();
    }

    generateRandomPlane() {
        // Generate random unit vector
        const plane = new Float32Array(this.dimensions);
        let sumSquares = 0;
        
        for (let i = 0; i < this.dimensions; i++) {
            plane[i] = Math.random() * 2 - 1;
            sumSquares += plane[i] * plane[i];
        }

        // Normalize
        const norm = Math.sqrt(sumSquares);
        for (let i = 0; i < this.dimensions; i++) {
            plane[i] /= norm;
        }

        return plane;
    }

    project(embedding, plane) {
        let sum = 0;
        for (let i = 0; i < this.dimensions; i++) {
            sum += embedding[i] * plane[i];
        }
        return sum;
    }

    async search(queryEmbedding, limit = 5) {
        const results = new Map(); // key -> count
        await this.searchNode(this.root, queryEmbedding, limit, results);
        return Array.from(results.keys());
    }

    async searchNode(node, queryEmbedding, limit, results) {
        if (node.isLeaf) {
            // Add all points in leaf
            for (const [key, embedding] of node.points) {
                results.set(key, (results.get(key) || 0) + 1);
            }
            return;
        }

        // Project query point
        const projection = this.project(queryEmbedding, node.splitPlane);
        
        // Search primary child
        const primaryChild = projection <= 0 ? node.left : node.right;
        await this.searchNode(primaryChild, queryEmbedding, limit, results);

        // Search secondary child if needed
        if (results.size < limit) {
            const secondaryChild = projection <= 0 ? node.right : node.left;
            await this.searchNode(secondaryChild, queryEmbedding, limit, results);
        }
    }
}

// Implement missing vector similarity methods
class VectorSimilarity {
    static cosineSimilarity(a, b) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    static euclideanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    static manhattanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += Math.abs(a[i] - b[i]);
        }
        return sum;
    }
}

// Add compression utilities
class CompressionUtil {
    static async compress(data) {
        // Convert data to string if needed
        const stringData = typeof data === 'string' ? data : JSON.stringify(data);
        
        // Convert string to Uint8Array
        const textEncoder = new TextEncoder();
        const uint8Array = textEncoder.encode(stringData);
        
        // Use CompressionStream when available, fallback to basic compression
        if (typeof CompressionStream !== 'undefined') {
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            await writer.write(uint8Array);
            await writer.close();
            return cs.readable;
        }
        
        // Basic fallback compression (implement actual compression algorithm here)
        return uint8Array;
    }

    static async decompress(compressedData) {
        // Use DecompressionStream when available, fallback to basic decompression
        if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            await writer.write(compressedData);
            await writer.close();
            const output = await new Response(ds.readable).arrayBuffer();
            const textDecoder = new TextDecoder();
            return textDecoder.decode(output);
        }
        
        // Basic fallback decompression (implement actual decompression algorithm here)
        const textDecoder = new TextDecoder();
        return textDecoder.decode(compressedData);
    }
}

// Implement Chain Utility methods
class ChainUtil {
    static hashChain(thoughtChain) {
        const chainString = JSON.stringify(thoughtChain.map(t => ({
            id: t.id,
            dependencies: t.dependencies || []
        })));
        
        // Create hash using available API
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(chainString))
                .then(hash => Array.from(new Uint8Array(hash))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join(''));
        }
        
        // Simple fallback hash
        let hash = 0;
        for (let i = 0; i < chainString.length; i++) {
            const char = chainString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    static explorePath(nodeId, graph, visited, currentPath) {
        if (visited.has(nodeId) || currentPath.has(nodeId)) {
            return [];
        }

        currentPath.add(nodeId);
        visited.add(nodeId);

        const node = graph.get(nodeId);
        const path = [nodeId];

        // Explore dependents
        for (const dependentId of node.dependents) {
            const subPath = this.explorePath(dependentId, graph, visited, currentPath);
            path.push(...subPath);
        }

        currentPath.delete(nodeId);
        return path;
    }

    static combinePaths(paths) {
        // Merge parallel and sequential paths
        const merged = {
            parallel: new Set(),
            sequential: new Map()
        };

        paths.forEach(path => {
            if (Array.isArray(path)) {
                // Single linear path
                path.forEach((nodeId, index) => {
                    if (index === 0) {
                        merged.parallel.add(nodeId);
                    } else {
                        merged.sequential.set(nodeId, path.slice(0, index));
                    }
                });
            } else {
                // Already optimized path
                path.parallel.forEach(nodeId => merged.parallel.add(nodeId));
                path.sequential.forEach((deps, nodeId) => {
                    merged.sequential.set(nodeId, deps);
                });
            }
        });

        return {
            parallel: Array.from(merged.parallel),
            sequential: Array.from(merged.sequential.entries())
        };
    }
}

// Export all components
export {
    RandomProjectionTree,
    VectorSimilarity,
    CompressionUtil,
    ChainUtil
};
