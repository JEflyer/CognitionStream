class CompressionUtil {
    // LZ77-based compression algorithm implementation
    static async compress(data) {
        // Convert data to string if needed
        const stringData = typeof data === 'string' ? data : JSON.stringify(data);

        // Convert string to Uint8Array for processing
        const textEncoder = new TextEncoder();
        const input = textEncoder.encode(stringData);

        const compressed = [];
        let pos = 0;

        while (pos < input.length) {
            const match = this.findLongestMatch(input, pos);

            if (match.length > 3) { // Only use matches longer than 3 bytes
                // Store as (distance, length) pair
                compressed.push([match.distance, match.length]);
                pos += match.length;
            } else {
                // Store literal byte
                compressed.push(input[pos]);
                pos++;
            }
        }

        // Convert compressed data to Uint8Array
        return this.encodeCompressed(compressed);
    }

    static async decompress(compressedData) {
        // Validate input
        if (!(compressedData instanceof Uint8Array)) {
            throw new Error('Invalid compressed data format');
        }

        const decoded = this.decodeCompressed(compressedData);
        const decompressed = [];
        const maxSize = 1024 * 1024 * 1024; // 1GB safety limit

        for (const token of decoded) {
            if (decompressed.length > maxSize) {
                throw new Error('Decompressed data exceeds size limit');
            }

            if (Array.isArray(token)) {
                const [distance, length] = token;

                // Validate distance and length
                if (distance <= 0 || distance > decompressed.length) {
                    throw new Error('Invalid back-reference distance');
                }
                if (length <= 0 || length > 1024 * 64) { // 64KB max match length
                    throw new Error('Invalid match length');
                }

                const start = decompressed.length - distance;
                // Safe copy with bounds checking
                for (let i = 0; i < length; i++) {
                    if (start + i >= decompressed.length) {
                        throw new Error('Invalid back-reference');
                    }
                    decompressed.push(decompressed[start + i]);
                }
            } else {
                // Validate literal byte
                if (!Number.isInteger(token) || token < 0 || token > 255) {
                    throw new Error('Invalid literal byte');
                }
                decompressed.push(token);
            }
        }

        return new TextDecoder().decode(new Uint8Array(decompressed));
    }

    // Helper method to find longest matching sequence
    static findLongestMatch(data, currentPos) {
        // Input validation
        if (!data || !data.length || currentPos < 0 || currentPos >= data.length) {
            throw new Error('Invalid input parameters for findLongestMatch');
        }

        const windowSize = 1024;
        const maxLength = 258;
        const searchStart = Math.max(0, currentPos - windowSize);
        const remainingLength = data.length - currentPos;

        let bestLength = 0;
        let bestDistance = 0;

        // Bounds checking
        for (let i = searchStart; i < currentPos; i++) {
            let length = 0;
            
            // Safe length checking
            while (
                length < maxLength &&
                length < remainingLength &&
                i + length < currentPos &&
                data[i + length] === data[currentPos + length]
            ) {
                length++;
            }

            if (length > bestLength) {
                bestLength = length;
                bestDistance = currentPos - i;
            }
        }

        return { length: bestLength, distance: bestDistance };
    }

    // Add cleanup method for temporary resources
    static async cleanupTemporaryResources() {
        try {
            // Implementation depends on what temporary resources are used
            // For example, clearing any temporary buffers or file handles
            this.clearTempBuffers();
            await this.releaseTempFiles();
        } catch (error) {
            console.error('Error cleaning up compression resources:', error);
            throw new Error('Failed to cleanup compression resources: ' + error.message);
        }
    }

    // Helper method to encode compressed data
    static encodeCompressed(compressed) {
        // Calculate total size needed
        let size = 0;
        compressed.forEach(token => {
            size += Array.isArray(token) ? 5 : 2; // 5 bytes for match, 2 for literal
        });

        const result = new Uint8Array(size);
        let pos = 0;

        compressed.forEach(token => {
            if (Array.isArray(token)) {
                // Mark as match with flag byte 1
                result[pos++] = 1;
                // Store distance (2 bytes)
                result[pos++] = token[0] >> 8;
                result[pos++] = token[0] & 0xFF;
                // Store length (2 bytes)
                result[pos++] = token[1] >> 8;
                result[pos++] = token[1] & 0xFF;
            } else {
                // Mark as literal with flag byte 0
                result[pos++] = 0;
                // Store literal byte
                result[pos++] = token;
            }
        });

        return result;
    }

    // Helper method to decode compressed data
    static decodeCompressed(data) {
        const result = [];
        let pos = 0;

        while (pos < data.length) {
            if (data[pos] === 1) {
                // Read match
                pos++;
                const distance = (data[pos] << 8) | data[pos + 1];
                const length = (data[pos + 2] << 8) | data[pos + 3];
                result.push([distance, length]);
                pos += 4;
            } else {
                // Read literal
                pos++;
                result.push(data[pos]);
                pos++;
            }
        }

        return result;
    }
}