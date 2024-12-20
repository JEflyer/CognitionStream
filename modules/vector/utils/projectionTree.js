import { AsyncLock } from '../../concurrency';

class RandomProjectionTree {
    constructor(dimensions = 128, maxLeafSize = 10) {
        this.dimensions = dimensions;
        this.maxLeafSize = maxLeafSize;
        this.root = this.createNode();
        this.nodeCount = 1;
        this.depth = 0;
        this.maxDepth = 0;
        this.vectorCount = 0;
        this.lock = new AsyncLock();
        this.rebalanceThreshold = 2; // Tree is unbalanced if depth ratio exceeds this
    }

    createNode() {
        return {
            isLeaf: true,
            points: new Map(), // key -> embedding
            splitPlane: null,
            left: null,
            right: null,
            size: 0,
            depth: 0,
            parent: null
        };
    }

    async insert(key, embedding) {
        return await this.lock.acquire('insert', async () => {
            try {
                if (!embedding || embedding.length !== this.dimensions) {
                    throw new Error(`Invalid embedding dimensions: expected ${this.dimensions}`);
                }

                await this.insertAtNode(this.root, key, embedding);
                this.vectorCount++;
                return true;
            } catch (error) {
                console.error('Error inserting into tree:', error);
                throw new Error('Failed to insert into tree: ' + error.message);
            }
        });
    }

    async insertAtNode(node, key, embedding) {
        if (node.isLeaf) {
            node.points.set(key, new Float32Array(embedding));
            node.size++;

            // Split if too many points and not too deep
            if (node.points.size > this.maxLeafSize && node.depth < 20) {
                await this.splitNode(node);
            }
            return;
        }

        // Non-leaf node: traverse to appropriate child
        const projection = this.project(embedding, node.splitPlane);
        const nextNode = projection <= 0 ? node.left : node.right;
        nextNode.parent = node;
        nextNode.depth = node.depth + 1;
        this.maxDepth = Math.max(this.maxDepth, nextNode.depth);
        
        await this.insertAtNode(nextNode, key, embedding);
        node.size++;
    }

    async splitNode(node) {
        try {
            // Generate random splitting plane
            node.splitPlane = await this.generateRandomPlane();
            node.left = this.createNode();
            node.right = this.createNode();
            node.isLeaf = false;
            this.nodeCount += 2;

            // Set child properties
            node.left.depth = node.right.depth = node.depth + 1;
            node.left.parent = node.right.parent = node;

            // Redistribute points
            for (const [key, embedding] of node.points) {
                const projection = this.project(embedding, node.splitPlane);
                const targetNode = projection <= 0 ? node.left : node.right;
                targetNode.points.set(key, embedding);
                targetNode.size++;
            }

            // Update max depth
            this.maxDepth = Math.max(this.maxDepth, node.depth + 1);

            // Clear points from this node
            node.points.clear();
        } catch (error) {
            console.error('Error splitting node:', error);
            throw new Error('Failed to split node: ' + error.message);
        }
    }

    async generateRandomPlane() {
        // Generate random unit vector for splitting plane
        const plane = new Float32Array(this.dimensions);
        let sumSquares = 0;

        // Use crypto random for better randomness if available
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const randomBytes = new Uint8Array(this.dimensions);
            crypto.getRandomValues(randomBytes);
            for (let i = 0; i < this.dimensions; i++) {
                plane[i] = (randomBytes[i] / 255) * 2 - 1;
                sumSquares += plane[i] * plane[i];
            }
        } else {
            for (let i = 0; i < this.dimensions; i++) {
                plane[i] = Math.random() * 2 - 1;
                sumSquares += plane[i] * plane[i];
            }
        }

        // Normalize the plane vector
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
        return await this.lock.acquire('search', async () => {
            try {
                if (!queryEmbedding || queryEmbedding.length !== this.dimensions) {
                    throw new Error('Invalid query embedding dimensions');
                }

                const results = new Map();
                await this.searchNode(this.root, queryEmbedding, limit, results);

                return Array.from(results.keys())
                    .sort((a, b) => results.get(b) - results.get(a))
                    .slice(0, limit);
            } catch (error) {
                console.error('Error during search:', error);
                throw new Error('Search failed: ' + error.message);
            }
        });
    }

    async searchNode(node, queryEmbedding, limit, results) {
        if (node.isLeaf) {
            for (const [key, embedding] of node.points) {
                const similarity = await this.calculateSimilarity(queryEmbedding, embedding);
                results.set(key, similarity);
            }
            return;
        }

        const projection = this.project(queryEmbedding, node.splitPlane);
        const [primaryChild, secondaryChild] = projection <= 0
            ? [node.left, node.right]
            : [node.right, node.left];

        await this.searchNode(primaryChild, queryEmbedding, limit, results);

        // Check if we need to explore the other branch
        if (this.shouldExploreSecondaryBranch(projection, results, limit)) {
            await this.searchNode(secondaryChild, queryEmbedding, limit, results);
        }
    }

    shouldExploreSecondaryBranch(projection, results, limit) {
        // If we don't have enough results yet, explore the other branch
        if (results.size < limit) return true;

        // Get the worst score among our current top results
        const scores = Array.from(results.values()).sort((a, b) => b - a);
        const worstScore = scores[limit - 1];

        // Calculate the maximum possible similarity in the other branch
        const splitDistance = Math.abs(projection);
        const maxPossibleSimilarity = Math.sqrt(1 - splitDistance * splitDistance);

        // Explore if the other branch might contain better results
        return maxPossibleSimilarity > worstScore;
    }

    async calculateSimilarity(a, b) {
        let dotProduct = 0;
        for (let i = 0; i < this.dimensions; i++) {
            dotProduct += a[i] * b[i];
        }
        return Math.max(-1, Math.min(1, dotProduct));
    }

    async delete(key) {
        return await this.lock.acquire('delete', async () => {
            try {
                const deleted = await this.deleteFromNode(this.root, key);
                if (deleted) {
                    this.vectorCount--;
                }
                return deleted;
            } catch (error) {
                console.error('Error deleting from tree:', error);
                throw new Error('Failed to delete from tree: ' + error.message);
            }
        });
    }

    async deleteFromNode(node, key) {
        if (node.isLeaf) {
            const deleted = node.points.delete(key);
            if (deleted) {
                node.size--;
                this.updateSizeUpwards(node.parent);
            }
            return deleted;
        }

        // Try both children if not leaf
        const deletedLeft = await this.deleteFromNode(node.left, key);
        if (deletedLeft) {
            node.size--;
            return true;
        }

        const deletedRight = await this.deleteFromNode(node.right, key);
        if (deletedRight) {
            node.size--;
            return true;
        }

        return false;
    }

    updateSizeUpwards(node) {
        while (node) {
            node.size = (node.left ? node.left.size : 0) + 
                       (node.right ? node.right.size : 0);
            node = node.parent;
        }
    }

    needsRebalancing() {
        if (this.vectorCount < 100) return false; // Don't rebalance small trees
        
        const minDepth = this.getMinDepth(this.root);
        const depthRatio = this.maxDepth / minDepth;
        
        return depthRatio > this.rebalanceThreshold;
    }

    getMinDepth(node) {
        if (node.isLeaf) return node.depth;
        return Math.min(
            this.getMinDepth(node.left),
            this.getMinDepth(node.right)
        );
    }

    async destroy() {
        return await this.lock.acquire('destroy', async () => {
            try {
                this.destroyNode(this.root);
                this.root = null;
                this.nodeCount = 0;
                this.vectorCount = 0;
                this.depth = 0;
                this.maxDepth = 0;
                return true;
            } catch (error) {
                console.error('Error destroying tree:', error);
                throw new Error('Failed to destroy tree: ' + error.message);
            }
        });
    }

    destroyNode(node) {
        if (!node) return;
        
        if (node.isLeaf) {
            node.points.clear();
        } else {
            this.destroyNode(node.left);
            this.destroyNode(node.right);
        }
        
        node.splitPlane = null;
        node.left = null;
        node.right = null;
        node.parent = null;
    }

    async getStats() {
        return {
            nodeCount: this.nodeCount,
            vectorCount: this.vectorCount,
            depth: this.maxDepth,
            minDepth: this.getMinDepth(this.root),
            averageLeafSize: this.calculateAverageLeafSize(),
            isBalanced: !this.needsRebalancing()
        };
    }

    calculateAverageLeafSize() {
        let leafSizes = [];
        this.collectLeafSizes(this.root, leafSizes);
        
        if (leafSizes.length === 0) return 0;
        
        const sum = leafSizes.reduce((a, b) => a + b, 0);
        return sum / leafSizes.length;
    }

    collectLeafSizes(node, sizes) {
        if (!node) return;
        
        if (node.isLeaf) {
            sizes.push(node.points.size);
        } else {
            this.collectLeafSizes(node.left, sizes);
            this.collectLeafSizes(node.right, sizes);
        }
    }
}

export {RandomProjectionTree}