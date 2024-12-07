const aiConfig = {
    endpoints: {
        embedding: 'https://api.example.com/v1/embeddings',
        compression: 'https://api.example.com/v1/compress',
        optimization: 'https://api.example.com/v1/optimize'
    },
    models: {
        embedding: 'text-embedding-model',
        compression: 'compression-model',
        optimization: 'chain-optimizer-model'
    },
    apiKey: 'your-api-key-here',
    options: {
        maxRetries: 3,
        timeout: 10000,
        batchSize: 32
    }
};

export default aiConfig;