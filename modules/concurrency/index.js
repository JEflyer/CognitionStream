import { AsyncLock } from './asyncLock.js';

export { AsyncLock };

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AsyncLock };
}