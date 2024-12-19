import { AsyncLock } from '../../concurrency';
import { RandomProjectionTree } from './utils/projectionTree';
import { ThoughtError } from '../errors/thoughtError';

class VectorIndex {
    constructor(dimensions = 128, numTrees = 10, maxLeafSize = 10) {
        this.dimensions = dimensions;
        this.numTrees = numTrees;
        this.maxLeafSize = maxLeafSize;
        this.trees = [];
        this.initializeTrees();
        this.vectorCache = new Map();
        this.lookupTable = new Map();
        this.indexLock = new AsyncLock();
        this.maintenanceInterval = null;
        this.lastMaintenance = Date.now();
    }

    async initializeTrees() {
        try {
            this.trees = Array.from({ length: this.numTrees }, () => 
                new RandomProjectionTree(this.dimensions, this.maxLeafSize)
            );
        } catch (error) {
            console.error('Failed to initialize trees:', error);
            throw new Error('Vector index initialization failed: ' + error.message);
        }
    }

    async add(key, embedding) {
        return await this.indexLock.acquire('add', async () => {
            try {
                // Validate input
                if (!key || !embedding) {
                    throw new Error('Invalid input: key and embedding are required');
                }
                if (embedding.length !== this.dimensions) {
                    throw new Error(`Invalid embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`);
                }

                // Normalize the embedding
                const normalizedEmbedding = await this.normalizeVector(embedding);

                // Add to all trees
                await Promise.all(this.trees.map(tree => 
                    tree.insert(key, normalizedEmbedding)
                ));

                // Update lookup table
                this.lookupTable.set(key, {
                    timestamp: Date.now(),
                    embedding: normalizedEmbedding
                });

                // Cache the normalized vector
                this.vectorCache.set(key, normalizedEmbedding);

                return true;
            } catch (error) {
                console.error('Error adding vector:', error);
                throw new Error('Failed to add vector: ' + error.message);
            }
        });
    }

    async search(queryEmbedding, limit = 5, similarityThreshold = 0.5) {
        try {
            // Validate input
            if (!queryEmbedding || queryEmbedding.length !== this.dimensions) {
                throw new Error('Invalid query embedding');
            }

            // Normalize query vector
            const normalizedQuery = await this.normalizeVector(queryEmbedding);

            // Search in all trees
            const results = new Map();
            await Promise.all(this.trees.map(async tree => {
                const treeResults = await tree.search(normalizedQuery, limit * 2);
                treeResults.forEach(key => {
                    results.set(key, (results.get(key) || 0) + 1);
                });
            }));

            // Calculate actual similarities for top candidates
            const similarities = await Promise.all(
                Array.from(results.entries()).map(async ([key, count]) => {
                    const storedVector = this.vectorCache.get(key);
                    if (!storedVector) return null;
                    
                    const similarity = await this.calculateCosineSimilarity(
                        normalizedQuery,
                        storedVector
                    );
                    return { key, similarity, count };
                })
            );

            // Filter, sort and return top results
            return similarities
                .filter(result => result && result.similarity >= similarityThreshold)
                .sort((a, b) => {
                    // Primary sort by similarity
                    const simDiff = b.similarity - a.similarity;
                    if (Math.abs(simDiff) > 0.01) return simDiff;
                    // Secondary sort by tree occurrence count
                    return b.count - a.count;
                })
                .slice(0, limit)
                .map(result => ({
                    key: result.key,
                    similarity: result.similarity
                }));

        } catch (error) {
            console.error('Error during vector search:', error);
            throw new Error('Vector search failed: ' + error.message);
        }
    }

    async delete(key) {
        return await this.indexLock.acquire('delete', async () => {
            try {
                // Remove from all trees
                await Promise.all(this.trees.map(tree => tree.delete(key)));

                // Clear from cache and lookup table
                this.vectorCache.delete(key);
                this.lookupTable.delete(key);

                return true;
            } catch (error) {
                console.error('Error deleting vector:', error);
                throw new Error('Failed to delete vector: ' + error.message);
            }
        });
    }

    async update(key, newEmbedding) {
        return await this.indexLock.acquire('update', async () => {
            try {
                await this.delete(key);
                return await this.add(key, newEmbedding);
            } catch (error) {
                console.error('Error updating vector:', error);
                throw new Error('Failed to update vector: ' + error.message);
            }
        });
    }

    async normalize(embedding) {
        return await this.normalizeVector(embedding);
    }

    async maintenance() {
        return await this.indexLock.acquire('maintenance', async () => {
            try {
                // Rebuild trees that are unbalanced
                await this.rebuildUnbalancedTrees();

                // Clean up old entries
                await this.cleanupOldEntries();

                // Update maintenance timestamp
                this.lastMaintenance = Date.now();
            } catch (error) {
                console.error('Error during maintenance:', error);
                throw new Error('Maintenance failed: ' + error.message);
            }
        });
    }

    async rebuildUnbalancedTrees() {
        const unbalancedTrees = this.trees.filter(tree => tree.needsRebalancing());
        if (unbalancedTrees.length === 0) return;

        // Get all vectors
        const vectors = Array.from(this.lookupTable.entries()).map(([key, data]) => ({
            key,
            embedding: data.embedding
        }));

        // Rebuild unbalanced trees
        await Promise.all(unbalancedTrees.map(async tree => {
            const newTree = new RandomProjectionTree(this.dimensions, this.maxLeafSize);
            for (const vector of vectors) {
                await newTree.insert(vector.key, vector.embedding);
            }
            const treeIndex = this.trees.indexOf(tree);
            this.trees[treeIndex] = newTree;
        }));
    }

    async cleanupOldEntries() {
        const now = Date.now();
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

        const oldKeys = Array.from(this.lookupTable.entries())
            .filter(([_, data]) => now - data.timestamp > maxAge)
            .map(([key]) => key);

        await Promise.all(oldKeys.map(key => this.delete(key)));
    }

    async normalizeVector(vector) {
        let norm = 0;
        for (let i = 0; i < vector.length; i++) {
            norm += vector[i] * vector[i];
        }
        norm = Math.sqrt(norm);

        if (norm === 0) {
            throw new Error('Cannot normalize zero vector');
        }

        return new Float32Array(vector.map(v => v / norm));
    }

    async calculateCosineSimilarity(a, b) {
        let dotProduct = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
        }
        return Math.max(-1, Math.min(1, dotProduct));
    }

    async destroy() {
        try {
            // Clear maintenance interval if exists
            if (this.maintenanceInterval) {
                clearInterval(this.maintenanceInterval);
                this.maintenanceInterval = null;
            }

            // Destroy all trees
            await Promise.all(this.trees.map(tree => tree.destroy()));

            // Clear caches
            this.vectorCache.clear();
            this.lookupTable.clear();

            // Clear arrays
            this.trees = [];

            return true;
        } catch (error) {
            console.error('Error destroying vector index:', error);
            throw new Error('Failed to destroy vector index: ' + error.message);
        }
    }

    async getStats() {
        return {
            numTrees: this.trees.length,
            numVectors: this.lookupTable.size,
            dimensions: this.dimensions,
            lastMaintenance: this.lastMaintenance,
            cacheSize: this.vectorCache.size,
            treeStats: await Promise.all(this.trees.map(tree => tree.getStats()))
        };
    }
}