class VectorStore {
    /**
     * @abstract
     * Generate an embedding for the given data
     * @param {*} data - Data to generate embedding for
     * @returns {Promise<Float32Array>} Generated embedding
     */
    async generateEmbedding(data) {
        throw new Error('generateEmbedding must be implemented');
    }

    /**
     * @abstract
     * Search for similar vectors
     * @param {Float32Array} queryEmbedding - Query vector
     * @param {number} limit - Maximum number of results
     * @param {number} similarityThreshold - Minimum similarity score
     * @returns {Promise<Array<{key: string, similarity: number}>>}
     */
    async search(queryEmbedding, limit, similarityThreshold) {
        throw new Error('search must be implemented');
    }

    /**
     * @abstract
     * Add a vector to the store
     * @param {string} key - Unique identifier
     * @param {Float32Array} embedding - Vector to store
     * @returns {Promise<void>}
     */
    async add(key, embedding) {
        throw new Error('add must be implemented');
    }

    /**
     * @abstract
     * Delete a vector from the store
     * @param {string} key - Key to delete
     * @returns {Promise<boolean>} True if deleted, false if not found
     */
    async delete(key) {
        throw new Error('delete must be implemented');
    }

    /**
     * @abstract
     * Clear all vectors from the store
     * @returns {Promise<void>}
     */
    async clear() {
        throw new Error('clear must be implemented');
    }

    /**
     * @abstract
     * Get the number of vectors in the store
     * @returns {Promise<number>}
     */
    async size() {
        throw new Error('size must be implemented');
    }

    /**
     * @abstract
     * Check if a key exists in the store
     * @param {string} key - Key to check
     * @returns {Promise<boolean>}
     */
    async has(key) {
        throw new Error('has must be implemented');
    }

    /**
     * @abstract
     * Get usage metrics for the store
     * @returns {Promise<Object>}
     */
    async getUsageMetrics() {
        throw new Error('getUsageMetrics must be implemented');
    }

    /**
     * @abstract
     * Clean up resources
     * @returns {Promise<void>}
     */
    async destroy() {
        throw new Error('destroy must be implemented');
    }

    /**
     * @abstract
     * Vacuum/optimize the store
     * @returns {Promise<void>}
     */
    async vacuum() {
        throw new Error('vacuum must be implemented');
    }

    /**
     * @abstract
     * Get the dimension of vectors in this store
     * @returns {number}
     */
    getDimensions() {
        throw new Error('getDimensions must be implemented');
    }
}

export {VectorStore}