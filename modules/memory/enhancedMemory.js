import { AsyncLock } from '../concurrency';
import { HybridStorage } from '../storage';
import { LRUCache } from './cache/lru';
import { EnhancedVectorStore } from '../vector';
import { ThoughtError } from '../errors/thoughtError';
import { CompressionUtil } from '../storage/utils/compression';

class EnhancedMemorySystem {
    #lock = new AsyncLock();


    constructor(config = {}) {
        this.modelCache = new Map(); 
        this.shortTermMemory = new HybridStorage({
            dbName: 'shortTermMemory',
            maxMemoryItems: config.shortTermLimit || 10000,
            storeName: 'shortTerm'
        });
        this.workingMemory = new LRUCache(config.workingMemorySize || 1000);
        this.vectorStore = new EnhancedVectorStore();
        this.memoryLimits = {
            shortTerm: config.shortTermLimit || 10000,
            working: config.workingMemoryLimit || 5000,
            vector: config.vectorLimit || 100000
        };
        this.cleanupInterval = config.cleanupInterval || 3600000; // 1 hour
        this.intervalId = null;
        this.setupAutoCleanup();

        this.aiConfig = {
            endpoint: config.aiEndpoint,
            apiKey: config.apiKey,
            compressionModel: config.compressionModel,
            retrievalModel: config.retrievalModel
        };

        this.lastCleanupAttempt = null;
        this.isCleaningUp = false;
        this.cleanupLock = new AsyncLock();
    }

    async releaseResources() {
        try {
            // Release any temporary compression resources
            await this.cleanupTemporaryResources();

            // Clear any cached data
            this.modelCache?.clear();

            // Additional resource cleanup as needed
            await this.vectorStore?.releaseResources();
            
            // Release shortTermMemory resources
            await this.shortTermMemory.destroy();
        } catch (error) {
            console.error('Error releasing resources:', error);
            throw new Error('Failed to release resources: ' + error.message);
        }
    }

    setupAutoCleanup() {
        // Clear existing interval if any
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        // Set up new cleanup interval with race condition protection
        this.intervalId = setInterval(async () => {
            try {
                await this.cleanupLock.acquire('cleanup', async () => {
                    if (this.isCleaningUp) {
                        return; // Skip if cleanup is already in progress
                    }
                    this.isCleaningUp = true;
                    this.lastCleanupAttempt = Date.now();
                    await this.performCleanup();
                    this.isCleaningUp = false;
                });
            } catch (error) {
                console.error('Error during auto cleanup:', error);
                this.isCleaningUp = false; // Reset flag on error
            }
        }, this.cleanupInterval);
    }

    async destroy() {
        try {
            // Clear cleanup interval
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }

            // Clean up vector store
            await this.vectorStore.destroy();

            // Clear working memory
            await this.workingMemory.clear();

            // Clear short-term memory
            await this.shortTermMemory.destroy();

            // Release any held resources
            await this.releaseResources();
        } catch (error) {
            console.error('Error during memory system destruction:', error);
            throw new Error('Failed to properly destroy memory system: ' + error.message);
        }
    }

    async performCleanup() {
        const now = Date.now();

        try {
            // Cleanup short-term memory
            await this.shortTermMemory.vacuum();

            // Enforce working memory size limit
            while (this.workingMemory.size() > this.memoryLimits.working) {
                await this.workingMemory.evictOldest();
            }

            // Trigger vacuum on vector store
            await this.vectorStore.vacuum().catch(error => {
                console.error('Error during vector store vacuum:', error);
                throw error;
            });

            // Optimize storage if needed
            await this.shortTermMemory.optimize();

        } catch (error) {
            console.error('Error during cleanup:', error);
            throw new Error('Cleanup failed: ' + error.message);
        }
    }

    async safeDelete(key, memoryType) {
        try {
            switch (memoryType) {
                case 'shortTerm':
                    await this.shortTermMemory.delete(key);
                    break;
                case 'working':
                    await this.workingMemory.delete(key);
                    break;
                case 'vector':
                    await this.vectorStore.delete(key);
                    break;
                default:
                    throw new Error(`Unknown memory type: ${memoryType}`);
            }
        } catch (error) {
            console.error(`Error deleting key ${key} from ${memoryType}:`, error);
            throw error;
        }
    }

    async store(key, data, type = 'shortTerm', metadata = {}) {
        return await this.#lock.acquire('store', async () => {
            const estimatedSize = this.calculateSize(data);
            const safetyBuffer = 1.1;

            if (!this.checkMemoryLimits(type, estimatedSize * safetyBuffer)) {
                throw new ThoughtError(
                    'MemoryLimitExceeded',
                    `Memory limit exceeded for ${type}`,
                    { size: estimatedSize, limit: this.memoryLimits[type] }
                );
            }

            const compressedData = await this.compress(data);
            const enhancedMetadata = {
                ...metadata,
                timestamp: Date.now(),
                type,
                originalSize: estimatedSize,
                compressedSize: this.calculateSize(compressedData)
            };

            switch (type) {
                case 'shortTerm':
                    await this.shortTermMemory.set(key, {
                        data: compressedData,
                        metadata: enhancedMetadata
                    }, {
                        priority: metadata.priority,
                        compression: true,
                        tags: metadata.tags
                    });
                    break;
                default:
                    throw new ThoughtError('InvalidMemoryType', `Unknown memory type: ${type}`);
            }

            return enhancedMetadata;
        });
    }

    async retrieve(key, type = 'shortTerm') {
        return await this.#lock.acquire('retrieve', async () => {
            let result;
            switch (type) {
                case 'shortTerm':
                    result = await this.shortTermMemory.get(key);
                    if (result) {
                        return await this.decompress(result.data, result.metadata);
                    }
                    break;
                default:
                    throw new ThoughtError('InvalidMemoryType', `Unknown memory type: ${type}`);
            }
            return null;
        });
    }

    async compress(data) {
        if (!this.aiConfig.compressionModel) {
            return data;
        }

        try {
            const response = await fetch(`${this.aiConfig.endpoint}/compress`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.aiConfig.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: data,
                    model: this.aiConfig.compressionModel
                })
            });

            if (!response.ok) {
                throw new Error(`Compression API request failed with status ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error('Compression failed', { cause: error });
        }
    }

    async decompress(data, metadata) {
        if (!this.aiConfig.compressionModel) {
            return data;
        }

        try {
            const response = await fetch(`${this.aiConfig.endpoint}/decompress`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.aiConfig.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: data,
                    metadata: metadata,
                    model: this.aiConfig.compressionModel
                })
            });

            if (!response.ok) {
                throw new Error(`Decompression API request failed with status ${response.status}`);
            }

            const decompressed = await response.json();

            // Validate decompressed data
            if (!decompressed || typeof decompressed !== 'object') {
                throw new Error('Invalid decompressed data format');
            }

            return decompressed;
        } catch (error) {
            throw new Error('Decompression failed', { cause: error });
        }
    }

    calculateSize(data) {
        return JSON.stringify(data).length;
    }

    checkMemoryLimits(type, size) {
        return size <= this.memoryLimits[type];
    }

    async getUsageMetrics() {
        const shortTermMetrics = await this.shortTermMemory.getMetrics();
        
        return {
            shortTerm: {
                size: shortTermMetrics.totalItems,
                capacityUsed: shortTermMetrics.totalSize / this.memoryLimits.shortTerm,
                hitRate: shortTermMetrics.hitRate,
                averageAccessTime: shortTermMetrics.averageAccessTime
            },
            working: {
                size: this.workingMemory.size(),
                capacityUsed: this.workingMemory.size() / this.memoryLimits.working
            },
            vector: await this.vectorStore.getUsageMetrics(),
            lastCleanup: this.lastCleanupAttempt,
            totalEntries: shortTermMetrics.totalItems +
                this.workingMemory.size() +
                await this.vectorStore.getEntryCount()
        };
    }

    async cleanupTemporaryResources() {
        await CompressionUtil.cleanupTemporaryResources();
    }
}

export {EnhancedMemorySystem}