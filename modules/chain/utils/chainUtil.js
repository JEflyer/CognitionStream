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

    static explorePath(nodeId, graph, visited = new Set(), currentPath = [], paths = []) {
        currentPath.push(nodeId);
    
        const node = graph.get(nodeId);
        if (!node) {
            currentPath.pop();
            return paths;
        }
    
        let hasDependents = false;
        for (const dependentId of node.dependents) {
            if (currentPath.includes(dependentId)) {
                throw new Error(`Circular dependency detected: ${nodeId} -> ${dependentId}`);
            }
    
            if (!visited.has(dependentId)) {
                hasDependents = true;
                ChainUtil.explorePath(dependentId, graph, visited, currentPath, paths);
            }
        }
    
        // If this is a leaf node (no dependents) or all dependents are visited
        if (!hasDependents) {
            // Make a copy of currentPath and add to paths
            paths.push([...currentPath]);
        }
    
        visited.add(nodeId);
        currentPath.pop();
        return paths;
    }
    
    

    static combinePaths(paths) {
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
                        const existingDeps = merged.sequential.get(nodeId) || [];
                        const newDeps = path.slice(0, index);
                        merged.sequential.set(nodeId, [...new Set([...existingDeps, ...newDeps])]);
                    }
                });
            } else {
                // Pre-optimized path: { parallel: [...], sequential: [[nodeId, deps], ...] }
                path.parallel.forEach(nodeId => merged.parallel.add(nodeId));
                path.sequential.forEach(([nodeId, deps]) => {
                    const existingDeps = merged.sequential.get(nodeId) || [];
                    merged.sequential.set(nodeId, [...new Set([...existingDeps, ...deps])]);
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