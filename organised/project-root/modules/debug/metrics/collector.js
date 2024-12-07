import { AsyncLock } from '../../../concurrency';
import os from 'os';  // Node.js built-in

class MetricsCollector {
    constructor(config = {}) {
        this.metricsHistory = new Map();
        this.historyLimit = config.historyLimit || 1000;
        this.samplingInterval = config.samplingInterval || 1000; // 1 second
        this.retentionPeriod = config.retentionPeriod || 24 * 60 * 60 * 1000; // 24 hours
        this.baselineWindow = config.baselineWindow || 60 * 60 * 1000; // 1 hour
        this.alertThresholds = config.alertThresholds || this.getDefaultThresholds();
        
        this.baselines = {
            network: this.initializeBaseline(),
            disk: this.initializeBaseline(),
            memory: this.initializeBaseline(),
            cpu: this.initializeBaseline()
        };

        this.collectors = new Map();
        this.intervalId = null;
        this.isCollecting = false;
        this.lastCollection = null;
        this.lock = new AsyncLock();
        this.initializeCollectors();
    }

    initializeBaseline() {
        return {
            values: [],
            lastUpdate: Date.now(),
            mean: 0,
            standardDeviation: 0
        };
    }

    getDefaultThresholds() {
        return {
            memory: {
                usage: 0.9, // 90% memory usage
                growth: 0.1 // 10% growth rate
            },
            cpu: {
                usage: 0.8, // 80% CPU usage
                sustained: 0.7 // 70% sustained usage
            },
            disk: {
                usage: 0.95, // 95% disk usage
                iops: 5000 // IOPS threshold
            },
            network: {
                bandwidth: 0.8, // 80% bandwidth usage
                errorRate: 0.01 // 1% error rate
            }
        };
    }

    initializeCollectors() {
        // Memory metrics collector
        this.collectors.set('memory', async () => {
            const memoryInfo = process.memoryUsage();
            return {
                heapUsed: memoryInfo.heapUsed,
                heapTotal: memoryInfo.heapTotal,
                external: memoryInfo.external,
                rss: memoryInfo.rss,
                arrayBuffers: memoryInfo.arrayBuffers || 0,
                usage: memoryInfo.heapUsed / memoryInfo.heapTotal,
                timestamp: Date.now()
            };
        });

        // CPU metrics collector
        this.collectors.set('cpu', async () => {
            const startUsage = process.cpuUsage();
            await new Promise(resolve => setTimeout(resolve, 100));
            const endUsage = process.cpuUsage(startUsage);
            const totalUsage = endUsage.user + endUsage.system;

            return {
                user: endUsage.user,
                system: endUsage.system,
                total: totalUsage,
                percentage: totalUsage / 1000000, // Convert to percentage
                loadAverage: os.loadavg(),
                timestamp: Date.now()
            };
        });

        // Disk metrics collector
        this.collectors.set('disk', async () => {
            try {
                const stats = await this.collectDiskStats();
                return {
                    reads: stats.reads,
                    writes: stats.writes,
                    iops: stats.iops,
                    latency: stats.latency,
                    utilization: stats.utilization,
                    timestamp: Date.now()
                };
            } catch (error) {
                console.error('Error collecting disk metrics:', error);
                return null;
            }
        });

        // Network metrics collector
        this.collectors.set('network', async () => {
            try {
                const stats = await this.collectNetworkStats();
                return {
                    bytesIn: stats.bytesIn,
                    bytesOut: stats.bytesOut,
                    packetsIn: stats.packetsIn,
                    packetsOut: stats.packetsOut,
                    errors: stats.errors,
                    dropped: stats.dropped,
                    timestamp: Date.now()
                };
            } catch (error) {
                console.error('Error collecting network metrics:', error);
                return null;
            }
        });
    }

    async start() {
        if (this.intervalId) {
            return;
        }

        this.intervalId = setInterval(
            () => this.collect().catch(console.error),
            this.samplingInterval
        );
    }

    async stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async collect() {
        return await this.lock.acquire('collect', async () => {
            if (this.isCollecting) {
                return;
            }

            this.isCollecting = true;
            try {
                const metrics = await this.collectAll();
                this.updateHistory(metrics);
                this.updateBaselines(metrics);
                await this.checkThresholds(metrics);
                this.lastCollection = Date.now();
                return metrics;
            } finally {
                this.isCollecting = false;
            }
        });
    }

    async collectAll() {
        const metrics = {};
        for (const [name, collector] of this.collectors) {
            try {
                metrics[name] = await collector();
            } catch (error) {
                console.error(`Error collecting ${name} metrics:`, error);
                metrics[name] = null;
            }
        }
        return metrics;
    }

    updateHistory(metrics) {
        const timestamp = Date.now();
        this.metricsHistory.set(timestamp, metrics);

        // Clean up old metrics
        const cutoff = timestamp - this.retentionPeriod;
        for (const [ts] of this.metricsHistory) {
            if (ts < cutoff) {
                this.metricsHistory.delete(ts);
            } else {
                break; // Map is ordered by insertion time
            }
        }

        // Enforce history limit
        while (this.metricsHistory.size > this.historyLimit) {
            const oldestKey = this.metricsHistory.keys().next().value;
            this.metricsHistory.delete(oldestKey);
        }
    }

    updateBaselines(metrics) {
        const now = Date.now();
        const types = ['network', 'disk', 'memory', 'cpu'];

        for (const type of types) {
            if (!metrics[type]) continue;

            const baseline = this.baselines[type];
            baseline.values.push(metrics[type]);

            // Keep only values within baseline window
            const cutoff = now - this.baselineWindow;
            baseline.values = baseline.values.filter(v => v.timestamp >= cutoff);

            // Calculate new baseline statistics
            if (baseline.values.length > 0) {
                this.updateBaselineStats(baseline);
            }

            baseline.lastUpdate = now;
        }
    }

    updateBaselineStats(baseline) {
        // Calculate mean
        const sum = baseline.values.reduce((acc, val) => acc + (val.usage || 0), 0);
        baseline.mean = sum / baseline.values.length;

        // Calculate standard deviation
        const squaredDiffs = baseline.values.map(val => 
            Math.pow((val.usage || 0) - baseline.mean, 2)
        );
        const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / squaredDiffs.length;
        baseline.standardDeviation = Math.sqrt(avgSquaredDiff);
    }

    async checkThresholds(metrics) {
        const alerts = [];

        // Check memory thresholds
        if (metrics.memory) {
            if (metrics.memory.usage > this.alertThresholds.memory.usage) {
                alerts.push({
                    type: 'memory',
                    severity: 'high',
                    message: 'Memory usage exceeds threshold',
                    value: metrics.memory.usage,
                    threshold: this.alertThresholds.memory.usage
                });
            }
        }

        // Check CPU thresholds
        if (metrics.cpu) {
            if (metrics.cpu.percentage > this.alertThresholds.cpu.usage) {
                alerts.push({
                    type: 'cpu',
                    severity: 'high',
                    message: 'CPU usage exceeds threshold',
                    value: metrics.cpu.percentage,
                    threshold: this.alertThresholds.cpu.usage
                });
            }
        }

        // Check disk thresholds
        if (metrics.disk) {
            if (metrics.disk.utilization > this.alertThresholds.disk.usage) {
                alerts.push({
                    type: 'disk',
                    severity: 'medium',
                    message: 'Disk utilization exceeds threshold',
                    value: metrics.disk.utilization,
                    threshold: this.alertThresholds.disk.usage
                });
            }
        }

        // Check network thresholds
        if (metrics.network) {
            const errorRate = metrics.network.errors / 
                (metrics.network.packetsIn + metrics.network.packetsOut);
            if (errorRate > this.alertThresholds.network.errorRate) {
                alerts.push({
                    type: 'network',
                    severity: 'medium',
                    message: 'Network error rate exceeds threshold',
                    value: errorRate,
                    threshold: this.alertThresholds.network.errorRate
                });
            }
        }

        return alerts;
    }

    async getMetrics(duration) {
        const now = Date.now();
        const startTime = duration ? now - duration : 0;

        return Array.from(this.metricsHistory.entries())
            .filter(([timestamp]) => timestamp >= startTime)
            .map(([timestamp, metrics]) => ({
                timestamp,
                metrics
            }));
    }

    async getBaselines() {
        return this.baselines;
    }

    async collectDiskStats() {
        // Implement actual disk stats collection based on your system
        // This is a placeholder implementation
        return {
            reads: Math.floor(Math.random() * 1000),
            writes: Math.floor(Math.random() * 1000),
            iops: Math.floor(Math.random() * 5000),
            latency: Math.random() * 10,
            utilization: Math.random()
        };
    }

    async collectNetworkStats() {
        // Implement actual network stats collection based on your system
        // This is a placeholder implementation
        return {
            bytesIn: Math.floor(Math.random() * 1000000),
            bytesOut: Math.floor(Math.random() * 1000000),
            packetsIn: Math.floor(Math.random() * 10000),
            packetsOut: Math.floor(Math.random() * 10000),
            errors: Math.floor(Math.random() * 10),
            dropped: Math.floor(Math.random() * 10)
        };
    }

    async destroy() {
        await this.stop();
        this.metricsHistory.clear();
        this.collectors.clear();
        this.baselines = null;
    }
}