/**
 * GameServerBridge - TypeScript interface to Rust game server
 *
 * Wraps Tauri invoke calls and provides type-safe access to the
 * Rust game server running in the Tauri backend.
 */

// Types matching Rust structs

export type RaceStatus = 'NotStarted' | 'Countdown' | 'Racing' | 'Finished';
export type GameState = 'Idle' | 'Loading' | 'Ready' | 'Racing' | 'Results';

export interface RunnerSnapshot {
  id: number;
  distance: number;
  lane_position: number;
  speed: number;
  animation_phase: number;
  finished: boolean;
}

export interface RaceSnapshot {
  status: RaceStatus;
  elapsed_time: number;
  countdown: number;
  runners: RunnerSnapshot[];
  finisher_count: number;
}

export interface RaceResult {
  runner_id: number;
  runner_name: string;
  finish_time: number;
  position: number;
}

export interface ServerStats {
  tick_rate: number;
  avg_tick_time_ms: number;
  runner_count: number;
  game_state: GameState;
}

// Check if we're running in Tauri
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// Lazy import Tauri invoke
async function getInvoke(): Promise<typeof import('@tauri-apps/api/core').invoke> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri environment');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

/**
 * GameServerBridge - Interface to Rust game server
 */
export class GameServerBridge {
  private invoke: typeof import('@tauri-apps/api/core').invoke | null = null;
  private initialized = false;

  /**
   * Initialize the bridge (must call before other methods)
   */
  async init(): Promise<boolean> {
    if (!isTauri()) {
      console.warn('GameServerBridge: Not running in Tauri, using mock mode');
      return false;
    }

    try {
      this.invoke = await getInvoke();
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('Failed to initialize Tauri bridge:', e);
      return false;
    }
  }

  /**
   * Check if bridge is available
   */
  isAvailable(): boolean {
    return this.initialized && this.invoke !== null;
  }

  /**
   * Initialize a new race
   */
  async initRace(runnerCount?: number, timeScale?: number): Promise<void> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    await this.invoke('init_race', { runner_count: runnerCount, time_scale: timeScale });
  }

  /**
   * Start the race countdown
   */
  async startRace(): Promise<void> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    await this.invoke('start_race');
  }

  /**
   * Perform a simulation tick and return current state
   */
  async tick(): Promise<RaceSnapshot | null> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    return await this.invoke('tick');
  }

  /**
   * Get current race snapshot without advancing simulation
   */
  async getSnapshot(): Promise<RaceSnapshot | null> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    return await this.invoke('get_snapshot');
  }

  /**
   * Get race results
   */
  async getResults(): Promise<RaceResult[] | null> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    return await this.invoke('get_results');
  }

  /**
   * Get server statistics
   */
  async getStats(): Promise<ServerStats> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    return await this.invoke('get_stats');
  }

  /**
   * Get current game state
   */
  async getGameState(): Promise<GameState> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    return await this.invoke('get_game_state');
  }

  /**
   * Pause the simulation
   */
  async pauseRace(): Promise<void> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    await this.invoke('pause_race');
  }

  /**
   * Resume the simulation
   */
  async resumeRace(): Promise<void> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    await this.invoke('resume_race');
  }

  /**
   * Reset to idle state
   */
  async resetRace(): Promise<void> {
    if (!this.invoke) throw new Error('Bridge not initialized');
    await this.invoke('reset_race');
  }
}

// Singleton instance
let bridgeInstance: GameServerBridge | null = null;

/**
 * Get the game server bridge instance
 */
export function getGameServerBridge(): GameServerBridge {
  if (!bridgeInstance) {
    bridgeInstance = new GameServerBridge();
  }
  return bridgeInstance;
}

/**
 * Check if running in Tauri environment
 */
export { isTauri };
