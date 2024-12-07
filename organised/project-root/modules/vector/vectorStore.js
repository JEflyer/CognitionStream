import { AsyncLock } from '../concurrency';
import { VectorIndex } from './vectorIndex';
import { VectorSimilarity } from './utils/similarity';
import { ThoughtError } from '../errors/thoughtError';
import { VectorStore } from './vectorStoreBase';

class EnhancedVectorStore extends VectorStore {
    constructor() {
        super();

        this.store = new Map();
        this.index = new VectorIndex();
        this.deletedKeys = new Set();
        this.modelCache = new Map();
        this.dimensions = 128; // Embedding dimension

        // After creating the index, assume the index initializes one or more trees.
        // We'll set this.root to the root of the first tree for searchNode operations.
        // This depends on VectorIndex and RandomProjectionTree implementation details.
        // If your VectorIndex creates multiple trees, just pick the first one:
        if (this.index.trees && this.index.trees.length > 0) {
            this.root = this.index.trees[0].root;
        } else {
            // If no trees exist yet, you may need to handle this differently or lazily.
            this.root = null;
        }

        this.apiConfig = {
            endpoint: null,
            apiKey: null,
            modelName: null
        };

        this.searchLock = new AsyncLock();
        this.updateLock = new AsyncLock();
    }

    // Implement abstract methods from VectorStore
    async add(key, embedding) {
        this.validateVector(embedding);
        this.normalizeVector(embedding);
        await this.index.add(key, embedding);
        this.store.set(key, embedding);
    }

    async delete(key) {
        const deleted = await this.index.delete(key);
        if (deleted) {
            this.store.delete(key);
            this.deletedKeys.add(key);
            return true;
        }
        return false;
    }

    async clear() {
        // Remove all vectors
        for (const key of this.store.keys()) {
            await this.delete(key);
        }
    }

    async size() {
        // Return the number of vectors currently stored
        return this.store.size;
    }

    async has(key) {
        return this.store.has(key);
    }

    async vacuum() {
        // If VectorIndex supports maintenance, call it here
        if (typeof this.index.maintenance === 'function') {
            await this.index.maintenance();
        }
    }

    async getUsageMetrics() {
        // Return basic usage metrics. Adjust as needed.
        return {
            vectorCount: await this.size(),
            dimensions: this.dimensions
        };
    }

    async generateEmbedding(data) {
        if (!this.apiConfig.endpoint || !this.apiConfig.apiKey) {
            throw new Error('API configuration missing');
        }

        try {
            const response = await fetch(this.apiConfig.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiConfig.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: typeof data === 'string' ? data : JSON.stringify(data),
                    model: this.apiConfig.modelName
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const result = await response.json();
            if (!result.embedding || !Array.isArray(result.embedding)) {
                throw new Error('Invalid embedding format received');
            }

            return new Float32Array(result.embedding);
        } catch (error) {
            throw new Error(`Embedding generation failed: ${error.message}`, { cause: error });
        }
    }

    async tokenize(text) {
        // Simple tokenization - split by whitespace and punctuation
        return text.toLowerCase()
            .replace(/[.,!?;:]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length > 0);
    }

    async hashTokens(tokens) {
        // Create a stable hash of the tokens
        const text = tokens.join(' ');
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hashBuffer);
    }

    applyPositionalEncoding(embedding, sequenceLength) {
        // Apply sinusoidal positional encoding
        const positionScale = 10000;
        for (let i = 0; i < this.dimensions; i += 2) {
            const position = i / this.dimensions;
            const scale = Math.exp(-(position * Math.log(positionScale)));

            embedding[i] *= Math.sin(sequenceLength * scale);
            if (i + 1 < this.dimensions) {
                embedding[i + 1] *= Math.cos(sequenceLength * scale);
            }
        }
    }

    async applyTokenFeatures(embedding, tokens) {
        // Apply token-specific features
        const features = await this.extractTokenFeatures(tokens);

        // Blend features into embedding
        const blendFactor = 0.3;
        for (let i = 0; i < this.dimensions && i < features.length; i++) {
            embedding[i] = embedding[i] * (1 - blendFactor) + features[i] * blendFactor;
        }
    }

    async extractTokenFeatures(tokens) {
        const features = new Float32Array(this.dimensions);

        // Calculate token statistics
        const tokenFreq = new Map();
        tokens.forEach(token => {
            tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
        });

        // Generate features based on token statistics
        let pos = 0;
        for (const [token, freq] of tokenFreq.entries()) {
            const tokenHash = await this.hashToken(token);
            const frequencyFactor = Math.log1p(freq) / Math.log1p(tokens.length);

            // Mix token features into the embedding
            for (let i = 0; i < 32 && pos < this.dimensions; i++, pos++) {
                features[pos] = (tokenHash[i % tokenHash.length] / 255) * frequencyFactor;
            }
        }

        return features;
    }

    async hashToken(token) {
        // Cache token hashes
        if (this.modelCache.has(token)) {
            return this.modelCache.get(token);
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(token);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hash = new Uint8Array(hashBuffer);

        this.modelCache.set(token, hash);
        return hash;
    }

    normalizeVector(vector) {
        // L2 normalization
        let norm = 0;
        for (let i = 0; i < vector.length; i++) {
            norm += vector[i] * vector[i];
        }
        norm = Math.sqrt(norm);

        if (norm > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] /= norm;
            }
        }
    }

    validateVector(vector) {
        if (!vector || !Array.isArray(vector)) {
            throw new Error('Invalid vector: must be an array');
        }
        if (vector.length !== this.dimensions) {
            throw new Error(`Invalid vector dimensions: expected ${this.dimensions}, got ${vector.length}`);
        }
        if (!vector.every(v => typeof v === 'number' && !isNaN(v))) {
            throw new Error('Invalid vector: all elements must be numbers');
        }
    }

    // Overriding the search method from VectorStore:
    async search(queryEmbedding, limit = 5, similarityThreshold = 0.5) {
        // Validate input vector
        this.validateVector(queryEmbedding);

        return await this.searchLock.acquire('search', async () => {
            const results = new Map();

            try {
                if (!this.root) {
                    throw new Error('No root node available for searching');
                }
                await this.searchNode(this.root, queryEmbedding, limit, results);

                // Sort and filter results atomically
                return Array.from(results.entries())
                    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
                    .filter(([, score]) => score >= similarityThreshold)
                    .slice(0, limit)
                    .map(([key]) => key);
            } catch (error) {
                console.error('Error during vector search:', error);
                throw new Error('Vector search failed: ' + error.message);
            }
        });
    }

    project(embedding, plane) {
        let sum = 0;
        for (let i = 0; i < this.dimensions; i++) {
            sum += embedding[i] * plane[i];
        }
        return sum;
    }

    async searchNode(node, queryEmbedding, limit, results) {
        if (node.isLeaf) {
            // Calculate actual similarity scores for leaf nodes
            for (const [key, embedding] of node.points) {
                const similarity = VectorSimilarity.cosineSimilarity(
                    queryEmbedding,
                    embedding
                );
                results.set(key, similarity);
            }
            return;
        }

        // Project query point and traverse tree
        const projection = this.project(queryEmbedding, node.splitPlane);
        const [primaryChild, secondaryChild] = projection <= 0
            ? [node.left, node.right]
            : [node.right, node.left];

        await this.searchNode(primaryChild, queryEmbedding, limit, results);

        // Check if we need to explore the other branch
        const currentBest = Array.from(results.values())
            .sort((a, b) => b - a)
            .slice(0, limit);
        const worstScore = currentBest.length < limit ? -Infinity : currentBest[currentBest.length - 1];

        // Explore other branch if it might contain better matches
        const splitDistance = Math.abs(projection);
        if (splitDistance < Math.sqrt(2 - 2 * worstScore)) {
            await this.searchNode(secondaryChild, queryEmbedding, limit, results);
        }
    }

    async destroy() {
        try {
            // Clear all stored vectors
            this.store.clear();

            // Clear index
            await this.index.destroy();

            // Clear caches
            this.modelCache.clear();
            this.deletedKeys.clear();

            // Release any held resources
            this.root = null;
        } catch (error) {
            console.error('Error destroying vector store:', error);
            throw new Error('Failed to destroy vector store: ' + error.message);
        }
    }
}

export { EnhancedVectorStore };