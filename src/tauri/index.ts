/**
 * Tauri Bridge Module
 *
 * Provides TypeScript interface to Rust game server running in Tauri backend.
 */

export {
  GameServerBridge,
  getGameServerBridge,
  isTauri,
  type RaceStatus,
  type GameState,
  type RunnerSnapshot,
  type RaceSnapshot,
  type RaceResult,
  type ServerStats,
} from './GameServerBridge';

export {
  RustWorldAdapter,
  getRustWorldAdapter,
  type AdapterConfig,
} from './RustWorldAdapter';
