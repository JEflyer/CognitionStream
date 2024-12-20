// Mock implementation of IDBKeyRange
const IDBKeyRange = {
    lowerBound: (value) => ({ lower: value, upperOpen: true, lowerOpen: false }),
    upperBound: (value) => ({ upper: value, upperOpen: false, lowerOpen: true }),
    bound: (lower, upper, lowerOpen, upperOpen) => ({ lower, upper, lowerOpen, upperOpen }),
    only: (value) => ({ only: value })
};

class MockIDBRequest {
    constructor() {
        this.result = undefined;
        this.error = null;
        this.source = null;
        this.transaction = null;
        this.readyState = 'pending';
        this.onsuccess = null;
        this.onerror = null;
    }
}

class MockIDBIndex {
    constructor(store, name, keyPath, options = {}) {
        this.store = store;
        this.name = name;
        this.keyPath = keyPath;
        this.unique = options.unique || false;
        this.multiEntry = options.multiEntry || false;
    }

    getIndexValue(entry) {
        if (typeof this.keyPath === 'string') {
            return entry[this.keyPath];
        }
        // Handle array keyPath if needed
        if (Array.isArray(this.keyPath)) {
            return this.keyPath.map(path => entry[path]);
        }
        return undefined;
    }

    openCursor(range) {
        const request = new MockIDBRequest();
        let entries = Array.from(this.store.data.values());

        // Filter entries based on the index and range
        if (range) {
            entries = entries.filter(entry => {
                const value = this.getIndexValue(entry);
                if (range.only !== undefined) {
                    return value === range.only;
                }
                if (range.lower !== undefined && range.upper !== undefined) {
                    const lowerCheck = range.lowerOpen ? value > range.lower : value >= range.lower;
                    const upperCheck = range.upperOpen ? value < range.upper : value <= range.upper;
                    return lowerCheck && upperCheck;
                }
                if (range.lower !== undefined) {
                    return range.lowerOpen ? value > range.lower : value >= range.lower;
                }
                if (range.upper !== undefined) {
                    return range.upperOpen ? value < range.upper : value <= range.upper;
                }
                return true;
            });
        }

        let currentIndex = 0;

        const advanceCursor = () => {
            if (currentIndex < entries.length) {
                const value = entries[currentIndex];
                const cursor = {
                    value,
                    continue: () => {
                        currentIndex++;
                        setTimeout(advanceCursor, 0);
                    },
                    delete: () => {
                        const delRequest = this.store.delete(value[this.store.keyPath]);
                        delRequest.onsuccess = () => cursor.continue();
                        return delRequest;
                    }
                };
                request.result = cursor;
                request.onsuccess && request.onsuccess({ target: request });
            } else {
                request.result = null;
                request.onsuccess && request.onsuccess({ target: request });
            }
        };

        setTimeout(advanceCursor, 0);
        return request;
    }

    count(key) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                let count = 0;
                const entries = Array.from(this.store.data.values());
                for (const entry of entries) {
                    const value = this.getIndexValue(entry);
                    if (key === undefined) {
                        count++;
                    } else {
                        // If key is provided, just do a simple equality check
                        if (value === key) count++;
                    }
                }
                request.result = count;
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }
}

class MockIDBObjectStore {
    constructor(name, options = {}) {
        this.name = name;
        this.keyPath = options.keyPath || 'id';
        this.autoIncrement = options.autoIncrement || false;
        this.data = new Map();
        this.indexes = new Map();
    }

    put(value) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                const key = value[this.keyPath];
                if (key === undefined) {
                    throw new Error('Key path not found in value');
                }
                this.data.set(key, value);
                request.result = key;
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }

    get(key) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                request.result = this.data.get(key);
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }

    delete(key) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                this.data.delete(key);
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }

    clear() {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                this.data.clear();
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }

    createIndex(name, keyPath, options = {}) {
        const index = new MockIDBIndex(this, name, keyPath, options);
        this.indexes.set(name, index);
        return index;
    }

    index(name) {
        return this.indexes.get(name);
    }

    count(key) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                if (key === undefined) {
                    request.result = this.data.size;
                } else {
                    request.result = this.data.has(key) ? 1 : 0;
                }
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }
}

class MockIDBTransaction {
    constructor(db, storeNames, mode = 'readonly') {
        this.db = db;
        this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
        this.mode = mode;
        this.error = null;
        this.aborted = false;
        this.startTime = Date.now();
    }

    objectStore(name) {
        if (!this.storeNames.includes(name)) {
            throw new Error(`Store ${name} not found in transaction`);
        }
        return this.db.stores.get(name);
    }

    abort() {
        this.aborted = true;
        if (this.onerror) {
            const error = new Error('Transaction aborted');
            this.error = error;
            this.onerror(new Event('error'));
        }
    }
}

class MockIDBDatabase {
    constructor(name) {
        this.name = name;
        this.version = 1;
        this.objectStoreNames = {
            contains: function(name) {
                return this._stores.includes(name);
            },
            _stores: []
        };
        this.stores = new Map();
        this.closed = false;
        this.onclose = null;
        this.onerror = null;
    }

    createObjectStore(name, options = {}) {
        const store = new MockIDBObjectStore(name, options);
        this.stores.set(name, store);
        this.objectStoreNames._stores.push(name);
        return store;
    }

    transaction(storeNames, mode = 'readonly') {
        return new MockIDBTransaction(this, storeNames, mode);
    }

    close() {
        this.closed = true;
        if (this.onclose) {
            this.onclose(new Event('close'));
        }
    }
}

const indexedDB = {
    databases: new Map(),

    open(name, version = 1) {
        const request = new MockIDBRequest();
        
        setTimeout(() => {
            try {
                let db;
                const existing = this.databases.get(name);
                
                if (!existing) {
                    db = new MockIDBDatabase(name);
                    this.databases.set(name, db);
                    request.result = db;
                    
                    if (request.onupgradeneeded) {
                        const event = {
                            target: request,
                            oldVersion: 0,
                            newVersion: version
                        };
                        request.onupgradeneeded(event);
                    }
                } else {
                    db = existing;
                }

                request.result = db;
                if (request.onsuccess) {
                    request.onsuccess({ target: request });
                }
            } catch (error) {
                request.error = error;
                if (request.onerror) {
                    request.onerror({ target: request });
                }
            }
        }, 0);

        return request;
    },

    deleteDatabase(name) {
        const request = new MockIDBRequest();
        setTimeout(() => {
            try {
                this.databases.delete(name);
                request.onsuccess && request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                request.onerror && request.onerror({ target: request });
            }
        }, 0);
        return request;
    }
};

export {
    indexedDB,
    MockIDBDatabase,
    MockIDBIndex,
    MockIDBObjectStore,
    MockIDBRequest,
    MockIDBTransaction,
    IDBKeyRange
};
