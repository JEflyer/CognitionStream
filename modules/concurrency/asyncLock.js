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

        // Initialize waiting list if needed
        if (!this.waiting.has(key)) {
            this.waiting.set(key, []);
        }

        // Create waiting promise for this acquisition attempt
        let waitResolve;
        const waitPromise = new Promise(resolve => {
            waitResolve = resolve;
        });

        // Add to waiting list
        const waiters = this.waiting.get(key);
        waiters.push(waitResolve);

        try {
            // If there's an existing lock, wait for it or timeout
            if (this.locks.has(key)) {
                const timeoutPromise = this.createTimeout(timeout);
                try {
                    await Promise.race([this.locks.get(key), timeoutPromise]);
                } catch (error) {
                    // Remove from waiting list before throwing timeout error
                    const index = waiters.indexOf(waitResolve);
                    if (index !== -1) {
                        waiters.splice(index, 1);
                    }
                    if (waiters.length === 0) {
                        this.waiting.delete(key);
                    }
                    this.metrics.timeouts++;
                    throw error;
                }
            }

            // Create new lock promise
            let lockResolve;
            const lockPromise = new Promise(resolve => {
                lockResolve = resolve;
            });
            this.locks.set(key, lockPromise);

            // Update metrics
            this.metrics.acquireCount++;
            if (waiters.length > 1) {
                this.metrics.contentionCount++;
            }

            try {
                // Execute function
                const result = await fn();
                return result;
            } catch (error) {
                // For function execution errors, ensure cleanup before rethrowing
                const index = waiters.indexOf(waitResolve);
                if (index !== -1) {
                    waiters.splice(index, 1);
                }
                if (waiters.length === 0) {
                    this.waiting.delete(key);
                }
                throw error;
            } finally {
                const waitTime = Date.now() - startTime;
                this.metrics.totalWaitTime += waitTime;

                // Clean up waiting list
                const index = waiters.indexOf(waitResolve);
                if (index !== -1) {
                    waiters.splice(index, 1);
                }
                if (waiters.length === 0) {
                    this.waiting.delete(key);
                }

                // Release lock
                lockResolve();
                if (this.locks.get(key) === lockPromise) {
                    this.locks.delete(key);
                }
            }
        } catch (error) {
            // Handle any unexpected errors
            throw error;
        }
    }

    async tryAcquire(key, fn, timeout = 0) {
        if (this.isLocked(key)) {
            return null;
        }
        try {
            return await this.acquire(key, fn, timeout);
        } catch (error) {
            if (error.name === 'LockTimeoutError') {
                return null;
            }
            throw error;
        }
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

    getWaitingCount(key) {
        const waiters = this.waiting.get(key);
        if (!waiters) return 0;
        // If there's an active lock, don't count the first waiter as it's currently executing
        return this.locks.has(key) ? waiters.length - 1 : waiters.length;
    }
    
    isLocked(key) {
        return this.locks.has(key) || (this.waiting.get(key)?.length > 0) || false;
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
            timeoutRate: this.metrics.timeouts / totalOperations
        };
    }


    async releaseAll() {
        // Copy all keys to avoid modification during iteration
        const lockKeys = Array.from(this.locks.keys());
        const waitingKeys = Array.from(this.waiting.keys());
    
        // Release all active locks
        for (const key of lockKeys) {
            const lockPromise = this.locks.get(key);
            if (lockPromise) {
                // Resolve the lock promise
                await lockPromise;
                this.locks.delete(key);
            }
        }
    
        // Release all waiting operations
        for (const key of waitingKeys) {
            const waiters = this.waiting.get(key);
            if (waiters) {
                // Copy waiters array to avoid modification during iteration
                const waitersCopy = [...waiters];
                // Resolve all waiters
                for (const resolve of waitersCopy) {
                    resolve();
                }
                this.waiting.delete(key);
            }
        }
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

    async isBusy() {
        return this.locks.size > 0 || Array.from(this.waiting.values())
            .some(list => list.length > 0);
    }
}

export {AsyncLock}