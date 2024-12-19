const { setupTestEnvironment } = require('./tests/test-setup');

// Set longer timeout for tests
jest.setTimeout(10000);

// Setup test environment before all tests
beforeAll(() => {
    setupTestEnvironment();
});

// Clear mocks between each test
beforeEach(() => {
    jest.clearAllMocks();
});