/**
 * Spatial Hash Grid for O(n) collision detection
 *
 * Instead of O(n²) pairwise collision checks, we:
 * 1. Hash each entity into grid cells based on position
 * 2. Only check collisions with entities in same/adjacent cells
 *
 * For 100 runners spread across a 400m track, this typically reduces
 * collision checks from 4950 (100*99/2) to ~300-500 per frame.
 */

export class SpatialHashGrid {
    constructor(cellSize = 5.0) {
        this.cellSize = cellSize;
        this.invCellSize = 1.0 / cellSize;
        this.cells = new Map();
        this.entityCells = new Map(); // Track which cell each entity is in
    }

    /**
     * Clear all cells for a new frame
     */
    clear() {
        this.cells.clear();
        this.entityCells.clear();
    }

    /**
     * Get cell key for a position
     */
    getCellKey(x, z) {
        const cellX = Math.floor(x * this.invCellSize);
        const cellZ = Math.floor(z * this.invCellSize);
        return `${cellX},${cellZ}`;
    }

    /**
     * Insert an entity into the grid
     * @param {number} id - Entity ID
     * @param {number} x - World X position
     * @param {number} z - World Z position
     */
    insert(id, x, z) {
        const key = this.getCellKey(x, z);

        if (!this.cells.has(key)) {
            this.cells.set(key, []);
        }

        this.cells.get(key).push(id);
        this.entityCells.set(id, key);
    }

    /**
     * Get all entities in the same and adjacent cells
     * @param {number} x - Query X position
     * @param {number} z - Query Z position
     * @returns {number[]} Array of entity IDs to check for collision
     */
    getNearby(x, z) {
        const cellX = Math.floor(x * this.invCellSize);
        const cellZ = Math.floor(z * this.invCellSize);

        const nearby = [];

        // Check 3x3 grid of cells around the query point
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${cellX + dx},${cellZ + dz}`;
                const cell = this.cells.get(key);
                if (cell) {
                    nearby.push(...cell);
                }
            }
        }

        return nearby;
    }

    /**
     * Get collision pairs for all entities (no duplicates)
     * @param {Float32Array} positionsX - X positions for all entities
     * @param {Float32Array} positionsZ - Z positions for all entities
     * @param {number} count - Number of entities
     * @returns {Array<[number, number]>} Array of [id1, id2] pairs to check
     */
    getCollisionPairs(positionsX, positionsZ, count) {
        // Rebuild grid
        this.clear();
        for (let i = 0; i < count; i++) {
            this.insert(i, positionsX[i], positionsZ[i]);
        }

        // Find pairs using spatial hashing
        const pairs = [];
        const checked = new Set();

        for (let i = 0; i < count; i++) {
            const x = positionsX[i];
            const z = positionsZ[i];
            const nearby = this.getNearby(x, z);

            for (const j of nearby) {
                if (i >= j) continue; // Avoid duplicates

                const pairKey = `${i},${j}`;
                if (checked.has(pairKey)) continue;
                checked.add(pairKey);

                pairs.push([i, j]);
            }
        }

        return pairs;
    }

    /**
     * Get statistics for debugging
     */
    getStats() {
        let totalEntities = 0;
        let maxPerCell = 0;
        let nonEmptyCells = 0;

        for (const [key, cell] of this.cells) {
            totalEntities += cell.length;
            maxPerCell = Math.max(maxPerCell, cell.length);
            nonEmptyCells++;
        }

        return {
            totalEntities,
            nonEmptyCells,
            maxPerCell,
            avgPerCell: nonEmptyCells > 0 ? totalEntities / nonEmptyCells : 0
        };
    }
}
