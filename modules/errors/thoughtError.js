class ThoughtError extends Error {
    constructor(code, message, context = {}) {
        // Call parent constructor
        super(message);

        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ThoughtError);
        }

        // Custom properties
        this.name = 'ThoughtError';
        this.code = code;
        this.timestamp = Date.now();
        this.context = this.sanitizeContext(context);
        this.severity = this.calculateSeverity(code);
        this.retryable = this.isRetryable(code);
    }

    // Predefined error codes and their properties
    static ErrorCodes = {
        // Memory-related errors
        MemoryLimitExceeded: {
            severity: 'high',
            retryable: false,
            category: 'resource'
        },
        MemoryAllocationFailed: {
            severity: 'high',
            retryable: true,
            category: 'resource'
        },

        // Processing errors
        InvalidInput: {
            severity: 'medium',
            retryable: false,
            category: 'validation'
        },
        ProcessingFailed: {
            severity: 'medium',
            retryable: true,
            category: 'operation'
        },
        
        // System errors
        SystemOverload: {
            severity: 'high',
            retryable: true,
            category: 'system'
        },
        InternalError: {
            severity: 'high',
            retryable: false,
            category: 'system'
        },

        // Data errors
        InvalidData: {
            severity: 'medium',
            retryable: false,
            category: 'data'
        },
        DataNotFound: {
            severity: 'low',
            retryable: false,
            category: 'data'
        },
        DataCorruption: {
            severity: 'high',
            retryable: false,
            category: 'data'
        },

        // Operation errors
        OperationTimeout: {
            severity: 'medium',
            retryable: true,
            category: 'operation'
        },
        OperationCancelled: {
            severity: 'low',
            retryable: true,
            category: 'operation'
        },
        ConcurrencyError: {
            severity: 'medium',
            retryable: true,
            category: 'operation'
        },

        // State errors
        InvalidState: {
            severity: 'medium',
            retryable: false,
            category: 'state'
        },
        StateTransitionFailed: {
            severity: 'medium',
            retryable: true,
            category: 'state'
        },

        // Configuration errors
        InvalidConfiguration: {
            severity: 'high',
            retryable: false,
            category: 'config'
        },
        ConfigurationMissing: {
            severity: 'high',
            retryable: false,
            category: 'config'
        }
    };

    calculateSeverity(code) {
        return ThoughtError.ErrorCodes[code]?.severity || 'medium';
    }

    isRetryable(code) {
        return ThoughtError.ErrorCodes[code]?.retryable ?? false;
    }

    getCategory() {
        return ThoughtError.ErrorCodes[this.code]?.category || 'unknown';
    }

    sanitizeContext(context) {
        const sanitized = {};
        
        for (const [key, value] of Object.entries(context)) {
            // Skip null or undefined values
            if (value == null) continue;

            // Handle different types of values
            if (typeof value === 'function') {
                sanitized[key] = '[Function]';
            } else if (value instanceof Error) {
                sanitized[key] = {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
            } else if (ArrayBuffer.isView(value)) {
                sanitized[key] = `[${value.constructor.name}]`;
            } else if (typeof value === 'object') {
                try {
                    // Attempt to safely stringify objects
                    sanitized[key] = JSON.parse(JSON.stringify(value));
                } catch {
                    sanitized[key] = '[Complex Object]';
                }
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            timestamp: this.timestamp,
            severity: this.severity,
            category: this.getCategory(),
            retryable: this.retryable,
            context: this.context,
            stack: this.stack
        };
    }

    toString() {
        return `${this.name}[${this.code}]: ${this.message} (Severity: ${this.severity}, Category: ${this.getCategory()})`;
    }

    static isThoughtError(error) {
        return error instanceof ThoughtError;
    }

    static fromError(error, code = 'InternalError', additionalContext = {}) {
        const context = {
            originalError: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            ...additionalContext
        };

        return new ThoughtError(code, error.message, context);
    }

    static wrapError(error, code = 'InternalError', message = null, additionalContext = {}) {
        if (ThoughtError.isThoughtError(error)) {
            // If it's already a ThoughtError, just add additional context
            error.context = {
                ...error.context,
                ...additionalContext
            };
            return error;
        }

        return ThoughtError.fromError(error, code, additionalContext);
    }

    getErrorDetails() {
        return {
            code: this.code,
            severity: this.severity,
            category: this.getCategory(),
            retryable: this.retryable,
            timestamp: this.timestamp,
            message: this.message,
            context: this.context
        };
    }

    isOfCategory(category) {
        return this.getCategory() === category;
    }

    shouldRetry(attemptsMade = 0, maxAttempts = 3) {
        if (!this.retryable) return false;
        if (attemptsMade >= maxAttempts) return false;
        
        // Additional retry logic based on error category
        switch (this.getCategory()) {
            case 'resource':
                return attemptsMade < 2; // Less retry attempts for resource errors
            case 'operation':
                return attemptsMade < maxAttempts;
            case 'system':
                return attemptsMade < maxAttempts - 1;
            default:
                return this.retryable && attemptsMade < maxAttempts;
        }
    }

    getRetryDelay(attemptsMade = 0) {
        // Exponential backoff with jitter
        const baseDelay = 1000; // 1 second
        const maxDelay = 30000; // 30 seconds
        
        let delay = baseDelay * Math.pow(2, attemptsMade);
        delay = Math.min(delay, maxDelay);
        
        // Add jitter (±25%)
        const jitter = delay * 0.25;
        delay += Math.random() * jitter * 2 - jitter;
        
        return Math.floor(delay);
    }
}