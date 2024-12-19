// jest.config.cjs
module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.js$': ['babel-jest', {
            presets: [
                ['@babel/preset-env', {
                    targets: {
                        node: 'current'
                    }
                }]
            ]
        }]
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },
    // setupFilesAfterEnv: ['./jest.setup.cjs'],
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    transformIgnorePatterns: [],
    testEnvironmentOptions: {
        url: 'http://localhost'
    },
    // extensionsToTreatAsEsm: ['.js']
}