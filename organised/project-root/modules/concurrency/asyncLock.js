class AsyncLock {
    constructor() {
        this.locks = new Map();
        this.waiting = new Map();
        this.debug = false;
        this.timeout = 10000;
        this.metrics = {
            acquireCount: 0,
            timeouts: 0,
            contentionCount: 0,
            totalWaitTime: 0
        };
    }

    async acquire(key, fn, timeout = this.timeout) {
        const startTime = Date.now();
        let lockResolve;
        let lockPromise;
        
        try {
            // Get or create the lock for this key
            if (!this.locks.has(key)) {
                this.locks.set(key, Promise.resolve());
            }

            const currentLock = this.locks.get(key);

            // Create a deferred promise for this lock request
            lockPromise = new Promise(resolve => {
                lockResolve = resolve;
            });

            // Add to waiting queue
            if (!this.waiting.has(key)) {
                this.waiting.set(key, []);
            }
            const waitingList = this.waiting.get(key);
            waitingList.push(lockResolve);

            // Wait for previous lock to complete with timeout
            await Promise.race([
                currentLock,
                this.createTimeout(timeout)
            ]);

            // Update metrics
            this.metrics.acquireCount++;
            if (waitingList.length > 1) {
                this.metrics.contentionCount++;
            }

            // Set this as the current lock
            this.locks.set(key, lockPromise);

            // Execute the function
            const result = await fn();

            return result;
        } catch (error) {
            if (error.name === 'LockTimeoutError') {
                this.metrics.timeouts++;
            }
            throw error;
        } finally {
            // Calculate wait time
            const waitTime = Date.now() - startTime;
            this.metrics.totalWaitTime += waitTime;

            // Remove from waiting queue
            const waitingList = this.waiting.get(key);
            if (waitingList && waitingList.length > 0) {
                const index = waitingList.findIndex(r => r === lockResolve);
                if (index !== -1) {
                    waitingList.splice(index, 1);
                }
                
                // Resolve current lock
                if (lockResolve) lockResolve();
                
                // Release the next waiting lock if any
                if (waitingList.length > 0) {
                    waitingList[0]();
                } else {
                    this.waiting.delete(key);
                    // Only delete the lock if there are no more waiters
                    if (this.locks.get(key) === lockPromise) {
                        this.locks.delete(key);
                    }
                }
            }

            if (this.debug) {
                console.log(`Lock ${key} released after ${waitTime}ms`);
            }
        }
    }

    async tryAcquire(key, fn, timeout = 0) {
        if (this.isLocked(key)) {
            return null;
        }
        
        return await this.acquire(key, fn, timeout);
    }

    async acquireMultiple(keys, fn, timeout = this.timeout) {
        // Sort keys to prevent deadlocks
        const sortedKeys = [...new Set(keys)].sort();
        
        // Acquire all locks in order
        const acquire = async (index) => {
            if (index >= sortedKeys.length) {
                return await fn();
            }
            
            return await this.acquire(sortedKeys[index], async () => {
                return await acquire(index + 1);
            }, timeout);
        };
        
        return await acquire(0);
    }

    async withLock(key, fn, timeout = this.timeout) {
        return await this.acquire(key, fn, timeout);
    }

    createTimeout(timeout) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error('Lock acquisition timed out');
                error.name = 'LockTimeoutError';
                reject(error);
            }, timeout);
        });
    }

    isLocked(key) {
        return this.locks.has(key) || (this.waiting.get(key)?.length > 0);
    }

    getWaitingCount(key) {
        return this.waiting.get(key)?.length || 0;
    }

    async isBusy() {
        return this.locks.size > 0 || Array.from(this.waiting.values()).some(list => list.length > 0);
    }

    getMetrics() {
        const totalOperations = this.metrics.acquireCount || 1;
        return {
            ...this.metrics,
            averageWaitTime: this.metrics.totalWaitTime / totalOperations,
            contentionRate: this.metrics.contentionCount / totalOperations,
            timeoutRate: this.metrics.timeouts / totalOperations,
            activeKeys: this.locks.size,
            waitingOperations: Array.from(this.waiting.values())
                .reduce((sum, list) => sum + list.length, 0)
        };
    }

    async releaseAll() {
        // Release all locks
        for (const [key, waitingList] of this.waiting.entries()) {
            for (const resolver of waitingList) {
                resolver();
            }
        }
        
        this.locks.clear();
        this.waiting.clear();
    }

    reset() {
        this.releaseAll();
        this.metrics = {
            acquireCount: 0,
            timeouts: 0,
            contentionCount: 0,
            totalWaitTime: 0
        };
    }

    setDebug(enabled) {
        this.debug = enabled;
    }

    setTimeout(timeout) {
        if (timeout <= 0) {
            throw new Error('Timeout must be greater than 0');
        }
        this.timeout = timeout;
    }
}

export { AsyncLock };

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AsyncLock };
}