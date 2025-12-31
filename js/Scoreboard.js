// Scoreboard.js - Save and load race results, leaderboard management

const STORAGE_KEY = 'trackRunnerScoreboard';
const MAX_ENTRIES_PER_MODE = 50; // Keep top 50 for each mode

/**
 * Scoreboard - Manages race results and leaderboards
 * - Saves results to localStorage
 * - Stores replay data for ghost racing
 * - Provides leaderboard queries
 */
export class Scoreboard {
    constructor() {
        this.entries = this.loadFromStorage();
    }

    /**
     * Load scoreboard from localStorage
     */
    loadFromStorage() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load scoreboard:', e);
        }
        return [];
    }

    /**
     * Save scoreboard to localStorage
     */
    saveToStorage() {
        try {
            // Prune old entries before saving
            this.pruneEntries();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        } catch (e) {
            console.error('Failed to save scoreboard:', e);
        }
    }

    /**
     * Prune old entries to keep storage manageable
     */
    pruneEntries() {
        // Group by mode
        const byMode = {};
        for (const entry of this.entries) {
            if (!byMode[entry.mode]) byMode[entry.mode] = [];
            byMode[entry.mode].push(entry);
        }

        // Keep only top N for each mode
        const pruned = [];
        for (const mode in byMode) {
            const sorted = byMode[mode].sort((a, b) => a.time - b.time);
            pruned.push(...sorted.slice(0, MAX_ENTRIES_PER_MODE));
        }

        this.entries = pruned;
    }

    /**
     * Save a race result
     * @param {string} raceMode - The race mode identifier
     * @param {Object} result - Race result from RelayManager or similar
     */
    saveResult(raceMode, result) {
        const entry = {
            id: this.generateId(),
            mode: raceMode,
            time: result.totalTime,
            splits: result.legSplits || result.splits || [],
            replayData: result.replayData || [],
            date: Date.now(),
            playerName: window.playerName || 'Anonymous',
            success: result.success !== false // Default to true if not specified
        };

        // Only save successful completions
        if (!entry.success) {
            console.log('Race not saved - did not finish');
            return null;
        }

        this.entries.push(entry);
        this.saveToStorage();

        console.log(`Saved result: ${entry.playerName} - ${this.formatTime(entry.time)}`);
        return entry;
    }

    /**
     * Generate a unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get top scores for a race mode
     * @param {string} raceMode - The race mode to query
     * @param {number} limit - Max number of results
     */
    getTopScores(raceMode, limit = 10) {
        return this.entries
            .filter(e => e.mode === raceMode && e.success)
            .sort((a, b) => a.time - b.time)
            .slice(0, limit);
    }

    /**
     * Get personal best for current player
     * @param {string} raceMode - The race mode to query
     */
    getPersonalBest(raceMode) {
        const playerName = window.playerName || 'Anonymous';
        const playerScores = this.entries
            .filter(e => e.mode === raceMode && e.playerName === playerName && e.success)
            .sort((a, b) => a.time - b.time);

        return playerScores.length > 0 ? playerScores[0] : null;
    }

    /**
     * Get recent races for ghost replay (most recent first)
     * @param {string} raceMode - The race mode to query
     * @param {number} limit - Max number of results (default 7 for lanes 2-8)
     */
    getRecentRaces(raceMode, limit = 7) {
        const playerName = window.playerName || 'Anonymous';
        return this.entries
            .filter(e => e.mode === raceMode && e.playerName === playerName && e.success && e.replayData && e.replayData.length > 0)
            .sort((a, b) => b.date - a.date) // Most recent first
            .slice(0, limit);
    }

    /**
     * Get a specific entry by ID (for loading replay)
     * @param {string} id - The entry ID
     */
    getEntryById(id) {
        return this.entries.find(e => e.id === id);
    }

    /**
     * Get replay data for a specific entry
     * @param {string} id - The entry ID
     */
    getReplayData(id) {
        const entry = this.getEntryById(id);
        return entry ? entry.replayData : null;
    }

    /**
     * Check if a time is a new personal best
     * @param {string} raceMode - The race mode
     * @param {number} time - The time to check
     */
    isNewPersonalBest(raceMode, time) {
        const pb = this.getPersonalBest(raceMode);
        return !pb || time < pb.time;
    }

    /**
     * Get rank of a time
     * @param {string} raceMode - The race mode
     * @param {number} time - The time to rank
     */
    getRank(raceMode, time) {
        const scores = this.getTopScores(raceMode, 1000);
        let rank = 1;
        for (const score of scores) {
            if (time > score.time) rank++;
            else break;
        }
        return rank;
    }

    /**
     * Format time as MM:SS.ms
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(2);
        return `${mins}:${secs.padStart(5, '0')}`;
    }

    /**
     * Format date for display
     */
    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString();
    }

    /**
     * Clear all entries (for testing)
     */
    clearAll() {
        this.entries = [];
        this.saveToStorage();
    }

    /**
     * Get all entries (for debugging)
     */
    getAllEntries() {
        return [...this.entries];
    }
}

// Singleton instance
let scoreboardInstance = null;

/**
 * Get the scoreboard singleton
 */
export function getScoreboard() {
    if (!scoreboardInstance) {
        scoreboardInstance = new Scoreboard();
    }
    return scoreboardInstance;
}
