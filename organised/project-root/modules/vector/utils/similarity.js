class VectorSimilarity {
    static validateVectors(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            throw new Error('Vectors must be arrays');
        }
        if (a.length !== b.length) {
            throw new Error(`Vector lengths don't match: ${a.length} vs ${b.length}`);
        }
        if (!a.every(v => typeof v === 'number' && !isNaN(v)) ||
            !b.every(v => typeof v === 'number' && !isNaN(v))) {
            throw new Error('Vectors must contain only numbers');
        }
    }

    static cosineSimilarity(a, b) {
        this.validateVectors(a, b);

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        // Handle zero vectors
        if (normA === 0 || normB === 0) {
            return 0;
        }

        // Use Math.fround for numerical stability
        return Math.fround(dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)));
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