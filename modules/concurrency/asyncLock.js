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

        // If there's no lock for this key, create a resolved promise (means no waiting)
        if (!this.locks.has(key)) {
            this.locks.set(key, Promise.resolve());
        }

        const previousLock = this.locks.get(key);
        let waitingEntry = null;
        const mustWait = (previousLock !== Promise.resolve());

        // If we must wait, add a function placeholder to waiting list
        if (mustWait) {
            if (!this.waiting.has(key)) {
                this.waiting.set(key, []);
            }
            waitingEntry = () => {}; // no-op function for waiting entry
            this.waiting.get(key).push(waitingEntry);
        }

        // Wait for previous lock or timeout
        await Promise.race([
            previousLock,
            this.createTimeout(timeout)
        ]).catch(err => {
            // If a timeout occurred
            if (err.name === 'LockTimeoutError') {
                this.metrics.timeouts++;
            }

            // Cleanup waiting entry on failure
            if (waitingEntry) {
                const wList = this.waiting.get(key);
                const idx = wList.indexOf(waitingEntry);
                if (idx !== -1) wList.splice(idx, 1);
                if (wList.length === 0) this.waiting.delete(key);
            }
            throw err;
        });

        // Now we have the lock
        let lockResolve;
        const lockPromise = new Promise(resolve => {
            lockResolve = resolve;
        });
        this.locks.set(key, lockPromise);

        // Update metrics
        this.metrics.acquireCount++;
        const waitingCount = this.waiting.get(key)?.length || 0;
        if (waitingCount > 0) {
            this.metrics.contentionCount++;
        }

        // Remove waiting entry now since we acquired the lock
        if (waitingEntry) {
            const wList = this.waiting.get(key);
            const idx = wList.indexOf(waitingEntry);
            if (idx !== -1) wList.splice(idx, 1);
            if (wList.length === 0) this.waiting.delete(key);
        }

        try {
            const result = await fn();
            return result;
        } finally {
            const waitTime = Date.now() - startTime;
            this.metrics.totalWaitTime += waitTime;

            // Release the lock so the next waiter (if any) can proceed
            lockResolve();

            // If no more locks waiting, remove from map
            if (this.locks.get(key) === lockPromise) {
                this.locks.delete(key);
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
        // Release all waiting operations by calling them (they are no-op functions)
        for (const waitingList of this.waiting.values()) {
            for (const resolver of waitingList) {
                // resolver is a function (no-op), call it
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

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AsyncLock };
}
