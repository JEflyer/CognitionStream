import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AsyncLock } from '../../modules/concurrency/asyncLock';
import { setupTestEnvironment, cleanupTestEnvironment, delay } from '../test-setup';


describe('AsyncLock', () => {
    let lock
    beforeEach(() => {
        setupTestEnvironment();
        lock = new AsyncLock();
    });

    afterEach(async () => {
        if (lock) {
            await lock.releaseAll();
        }
        cleanupTestEnvironment();
    });

    describe('acquire', () => {
        it('should execute function with lock', async () => {
            const result = await lock.acquire('testKey', () => 'test');
            expect(result).toBe('test');
        });

        it('should execute functions sequentially for same key', async () => {
            const sequence = [];
            const fn1 = async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                sequence.push(1);
                return 1;
            };
            const fn2 = async () => {
                sequence.push(2);
                return 2;
            };

            const [result1, result2] = await Promise.all([
                lock.acquire('testKey', fn1),
                lock.acquire('testKey', fn2)
            ]);

            expect(sequence).toEqual([1, 2]);
            expect(result1).toBe(1);
            expect(result2).toBe(2);
        });

        it('should allow parallel execution for different keys', async () => {
            const sequence = [];
            const fn1 = async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                sequence.push(1);
                return 1;
            };
            const fn2 = async () => {
                sequence.push(2);
                return 2;
            };

            const [result1, result2] = await Promise.all([
                lock.acquire('key1', fn1),
                lock.acquire('key2', fn2)
            ]);

            expect(sequence).toEqual([2, 1]);
            expect(result1).toBe(1);
            expect(result2).toBe(2);
        });

        it('should timeout if lock cannot be acquired', async () => {
            const longRunning = () => new Promise(resolve => setTimeout(resolve, 1000));
            const quick = () => 'quick';

            // Start long-running task
            const longPromise = lock.acquire('testKey', longRunning);

            // Try to acquire same lock with short timeout
            await expect(
                lock.acquire('testKey', quick, 100)
            ).rejects.toThrow('Lock acquisition timed out');

            await longPromise;
        });

        it('should handle errors in locked function', async () => {
            const errorFn = () => {
                throw new Error('Test error');
            };

            await expect(
                lock.acquire('testKey', errorFn)
            ).rejects.toThrow('Test error');

            // Lock should be released after error
            const result = await lock.acquire('testKey', () => 'test');
            expect(result).toBe('test');
        });
    });

    describe('isLocked', () => {
        it('should return true when key is locked', async () => {
            const promise = lock.acquire('testKey', async () => {
                expect(lock.isLocked('testKey')).toBe(true);
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(lock.isLocked('testKey')).toBe(true);
            await promise;
        });

        it('should return false when key is not locked', () => {
            expect(lock.isLocked('testKey')).toBe(false);
        });
    });

    describe('getWaitingCount', () => {
        it('should return correct number of waiting operations', async () => {
            const longRunning = () => new Promise(resolve => setTimeout(resolve, 100));
            
            // Start long-running task
            const promise1 = lock.acquire('testKey', longRunning);
            
            // Queue up more tasks
            const promise2 = lock.acquire('testKey', () => 'test2');
            const promise3 = lock.acquire('testKey', () => 'test3');

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(lock.getWaitingCount('testKey')).toBe(2);

            await Promise.all([promise1, promise2, promise3]);
            expect(lock.getWaitingCount('testKey')).toBe(0);
        });
    });

    describe('isBusy', () => {
        it('should return true when there are active or waiting operations', async () => {
            const promise = lock.acquire('testKey', async () => {
                expect(await lock.isBusy()).toBe(true);
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(await lock.isBusy()).toBe(true);
            await promise;
            expect(await lock.isBusy()).toBe(false);
        });
    });

    describe('getMetrics', () => {
        it('should track acquisition metrics', async () => {
            await lock.acquire('testKey', () => 'test1');
            await lock.acquire('testKey', () => 'test2');

            const metrics = lock.getMetrics();
            expect(metrics.acquireCount).toBe(2);
            expect(metrics.timeouts).toBe(0);
        });

        it('should track timeout metrics', async () => {
            const longRunning = () => new Promise(resolve => setTimeout(resolve, 1000));
            
            // Start long-running task
            const promise1 = lock.acquire('testKey', longRunning);
            
            // Try to acquire with timeout
            try {
                await lock.acquire('testKey', () => 'test', 100);
            } catch (error) {
                // Expected timeout
            }

            await promise1;
            const metrics = lock.getMetrics();
            expect(metrics.timeouts).toBe(1);
        });
    });

    describe('releaseAll', () => {
        it('should release all locks', async () => {
            // Create multiple locks
            const promise1 = lock.acquire('key1', () => 
                new Promise(resolve => setTimeout(resolve, 1000)));
            const promise2 = lock.acquire('key2', () => 
                new Promise(resolve => setTimeout(resolve, 1000)));

            await new Promise(resolve => setTimeout(resolve, 10));
            await lock.releaseAll();

            expect(lock.isLocked('key1')).toBe(false);
            expect(lock.isLocked('key2')).toBe(false);

            // Cleanup pending promises
            await Promise.allSettled([promise1, promise2]);
        });
    });

    describe('acquireMultiple', () => {
        it('should acquire multiple locks in order', async () => {
            const sequence = [];
            await lock.acquireMultiple(
                ['key1', 'key2', 'key3'],
                async () => {
                    sequence.push('executed');
                    expect(lock.isLocked('key1')).toBe(true);
                    expect(lock.isLocked('key2')).toBe(true);
                    expect(lock.isLocked('key3')).toBe(true);
                }
            );
            expect(sequence).toEqual(['executed']);
        });

        it('should prevent deadlocks by acquiring in sorted order', async () => {
            const sequence = [];
            await Promise.all([
                lock.acquireMultiple(['key2', 'key1'], async () => {
                    sequence.push(1);
                }),
                lock.acquireMultiple(['key1', 'key2'], async () => {
                    sequence.push(2);
                })
            ]);
            expect(sequence.length).toBe(2);
        });
    });

    describe('tryAcquire', () => {
        it('should acquire lock if available', async () => {
            const result = await lock.tryAcquire('testKey', () => 'test');
            expect(result).toBe('test');
        });

        it('should return null if lock is not available', async () => {
            const longRunning = () => new Promise(resolve => setTimeout(resolve, 100));
            const promise1 = lock.acquire('testKey', longRunning);

            const result = await lock.tryAcquire('testKey', () => 'test');
            expect(result).toBeNull();

            await promise1;
        });
    });
});