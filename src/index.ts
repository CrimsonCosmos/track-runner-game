/**
 * Track Runner - ECS Game Engine
 *
 * Main entry point for the new ECS-based game engine.
 * Exports all core functionality for use in the game.
 */

// Core ECS
export * from './core/components';
export { World, type TrackPath, type RaceData, type WorldStats } from './core/World';

// Systems
export { updateMovement, type MovementSystemConfig } from './core/systems/MovementSystem';
export { resolveCollisions, SpatialHashGrid, type CollisionStats } from './core/systems/CollisionSystem';

// Rendering
export {
  SharedAnimationSystem,
  SkinnedAnimationPool,
  LODAnimationSystem,
  type AnimationConfig
} from './rendering/SharedAnimationSystem';

// Game Bridge (for integration with existing code)
export {
  GameController,
  generate100Runners,
  generateFormation,
  createRunnerGeometry,
  calculateTimeScale
} from './game/GameBridge';

// Tauri Bridge (for Rust backend integration)
export * from './tauri';
