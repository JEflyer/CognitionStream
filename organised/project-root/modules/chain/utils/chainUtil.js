class ChainUtil {
    static hashChain(thoughtChain) {
        const chainString = JSON.stringify(thoughtChain.map(t => ({
            id: t.id,
            dependencies: t.dependencies || []
        })));

        // Create hash using available API
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(chainString))
                .then(hash => Array.from(new Uint8Array(hash))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join(''));
        }

        // Simple fallback hash
        let hash = 0;
        for (let i = 0; i < chainString.length; i++) {
            const char = chainString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    static explorePath(nodeId, graph, visited = new Set(), currentPath = new Set(), paths = []) {
        // Track the current exploration path
        currentPath.add(nodeId);

        const node = graph.get(nodeId);
        if (!node) {
            currentPath.delete(nodeId);
            return [];
        }

        // Explore all dependents
        for (const dependentId of node.dependents) {
            if (currentPath.has(dependentId)) {
                throw new Error(`Circular dependency detected: ${nodeId} -> ${dependentId}`);
            }

            if (!visited.has(dependentId)) {
                // Recursively explore and collect all valid paths
                const subPaths = this.explorePath(dependentId, graph, visited, currentPath, paths);
                paths.push(...subPaths.map(path => [nodeId, ...path]));
            }
        }

        // If this is a leaf node (no dependents) or all dependents are visited
        if (node.dependents.size === 0 ||
            Array.from(node.dependents).every(dep => visited.has(dep))) {
            paths.push([nodeId]);
        }

        visited.add(nodeId);
        currentPath.delete(nodeId);
        return paths;
    }

    static combinePaths(paths) {
        // Merge parallel and sequential paths
        const merged = {
            parallel: new Set(),
            sequential: new Map()
        };

        paths.forEach(path => {
            if (Array.isArray(path)) {
                // Single linear path
                path.forEach((nodeId, index) => {
                    if (index === 0) {
                        merged.parallel.add(nodeId);
                    } else {
                        merged.sequential.set(nodeId, path.slice(0, index));
                    }
                });
            } else {
                // Already optimized path
                path.parallel.forEach(nodeId => merged.parallel.add(nodeId));
                path.sequential.forEach((deps, nodeId) => {
                    merged.sequential.set(nodeId, deps);
                });
            }
        });

        return {
            parallel: Array.from(merged.parallel),
            sequential: Array.from(merged.sequential.entries())
        };
    }
}

export { ChainUtil };