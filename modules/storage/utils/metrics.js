class StorageMetrics {
    constructor(config = {}) {
        this.metrics = {
            hits: 0,
            misses: 0,
            writes: 0,
            deletes: 0,
            errors: 0,
            totalSize: 0,
            itemCount: 0
        };

        this.accessTimes = [];
        this.maxAccessTimes = config.maxAccessTimes || 1000;
        this.sizeThreshold = config.sizeThreshold || 100000; // 100KB
        this.fragmentationThreshold = config.fragmentationThreshold || 0.3; // 30%
        
        // Performance tracking
        this.performanceMetrics = {
            averageAccessTime: 0,
            peakAccessTime: 0,
            lastOptimization: Date.now(),
            fragmentationLevel: 0
        };
    }

    recordHit() {
        this.metrics.hits++;
    }

    recordMiss() {
        this.metrics.misses++;
    }

    recordWrite() {
        this.metrics.writes++;
    }

    recordDelete() {
        this.metrics.deletes++;
    }

    recordError() {
        this.metrics.errors++;
    }

    recordAccessTime(duration) {
        this.accessTimes.push({
            timestamp: Date.now(),
            duration
        });

        // Update peak access time
        this.performanceMetrics.peakAccessTime = Math.max(
            this.performanceMetrics.peakAccessTime,
            duration
        );

        // Maintain size limit
        while (this.accessTimes.length > this.maxAccessTimes) {
            this.accessTimes.shift();
        }

        // Update average
        const sum = this.accessTimes.reduce((acc, val) => acc + val.duration, 0);
        this.performanceMetrics.averageAccessTime = sum / this.accessTimes.length;
    }

    updateSize(itemSize, isAddition = true) {
        if (isAddition) {
            this.metrics.totalSize += itemSize;
            this.metrics.itemCount++;
        } else {
            this.metrics.totalSize = Math.max(0, this.metrics.totalSize - itemSize);
            this.metrics.itemCount = Math.max(0, this.metrics.itemCount - 1);
        }
    }

    calculateItemSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // Approximate UTF-16 string size
        }
        return JSON.stringify(value).length * 2;
    }

    getHitRate() {
        const total = this.metrics.hits + this.metrics.misses;
        return total === 0 ? 0 : this.metrics.hits / total;
    }

    getWriteRate() {
        const total = this.metrics.writes + this.metrics.deletes;
        return total === 0 ? 0 : this.metrics.writes / total;
    }

    getErrorRate() {
        const total = this.getTotalOperations();
        return total === 0 ? 0 : this.metrics.errors / total;
    }

    getTotalOperations() {
        return this.metrics.hits + 
               this.metrics.misses + 
               this.metrics.writes + 
               this.metrics.deletes;
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            hitRate: this.getHitRate(),
            writeRate: this.getWriteRate(),
            errorRate: this.getErrorRate(),
            averageItemSize: this.getAverageItemSize(),
            utilizationRate: this.getUtilizationRate()
        };
    }

    getAverageItemSize() {
        return this.metrics.itemCount === 0 ? 
            0 : 
            this.metrics.totalSize / this.metrics.itemCount;
    }

    getUtilizationRate() {
        // Calculate storage utilization (used space vs. allocated space)
        return this.metrics.totalSize / (this.metrics.itemCount * this.getAverageItemSize());
    }

    analyzeAccessPatterns() {
        const now = Date.now();
        const recentAccesses = this.accessTimes.filter(
            access => now - access.timestamp < 3600000 // Last hour
        );

        return {
            averageAccessTime: this.performanceMetrics.averageAccessTime,
            hitRate: this.getHitRate(),
            recentAccessCount: recentAccesses.length,
            writeRate: this.getWriteRate(),
            errorRate: this.getErrorRate(),
            fragmentation: this.calculateFragmentation()
        };
    }

    shouldOptimize() {
        const analysis = this.analyzeAccessPatterns();
        
        return (
            analysis.hitRate < 0.5 || // Low hit rate
            analysis.fragmentation > this.fragmentationThreshold || // High fragmentation
            analysis.errorRate > 0.05 || // High error rate
            this.performanceMetrics.averageAccessTime > 100 // Slow access times
        );
    }

    calculateFragmentation() {
        if (this.metrics.itemCount === 0) return 0;

        // Calculate theoretical minimum space needed
        const idealSpace = this.metrics.itemCount * this.getAverageItemSize();
        
        // Compare with actual space used
        return Math.max(0, 1 - (idealSpace / this.metrics.totalSize));
    }

    reset() {
        this.metrics = {
            hits: 0,
            misses: 0,
            writes: 0,
            deletes: 0,
            errors: 0,
            totalSize: 0,
            itemCount: 0
        };
        
        this.accessTimes = [];
        this.performanceMetrics = {
            averageAccessTime: 0,
            peakAccessTime: 0,
            lastOptimization: Date.now(),
            fragmentationLevel: 0
        };
    }

    getMetricsSummary() {
        return {
            metrics: { ...this.metrics },
            performance: this.getPerformanceMetrics(),
            analysis: this.analyzeAccessPatterns(),
            timestamp: Date.now()
        };
    }
}