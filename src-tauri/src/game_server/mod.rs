//! Game Server Module
//!
//! Handles 100-runner simulation in Rust for optimal performance.
//! Communicates with the JS frontend via Tauri commands.

pub mod runner;
pub mod race;
pub mod simulation;

pub use runner::{Runner, RunnerState};
pub use race::{Race, RaceConfig, RaceStatus};
pub use simulation::{GameServer, GameState};
