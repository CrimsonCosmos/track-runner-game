//! Simulation - Main game server and loop
//!
//! Manages the game server state, handles tick updates, and
//! provides the interface for Tauri commands.

use std::sync::{Arc, RwLock};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use crate::game_server::race::{Race, RaceConfig, RaceSnapshot, RaceStatus, RaceResult};

/// Game state for the local AI mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameState {
    Idle,
    Loading,
    Ready,
    Racing,
    Results,
}

/// Server statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStats {
    pub tick_rate: f32,
    pub avg_tick_time_ms: f32,
    pub runner_count: u32,
    pub game_state: GameState,
}

/// Main game server
pub struct GameServer {
    /// Current game state
    state: GameState,
    /// Active race (if any)
    race: Option<Race>,
    /// Target tick rate (ticks per second)
    tick_rate: f32,
    /// Last tick timestamp
    last_tick: Instant,
    /// Accumulated tick time for averaging
    tick_times: Vec<f32>,
    /// Whether the server is running
    running: bool,
}

impl GameServer {
    /// Create a new game server
    pub fn new() -> Self {
        Self {
            state: GameState::Idle,
            race: None,
            tick_rate: 60.0,
            last_tick: Instant::now(),
            tick_times: Vec::with_capacity(60),
            running: false,
        }
    }

    /// Initialize a new race with given config
    pub fn init_race(&mut self, config: RaceConfig) {
        self.state = GameState::Loading;

        let mut race = Race::new(config);
        race.generate_runners();
        race.setup_starting_positions();

        self.race = Some(race);
        self.state = GameState::Ready;
    }

    /// Start the race countdown
    pub fn start_race(&mut self) {
        if let Some(race) = &mut self.race {
            race.start_countdown();
            self.state = GameState::Racing;
            self.running = true;
            self.last_tick = Instant::now();
        }
    }

    /// Perform a single simulation tick
    pub fn tick(&mut self) -> Option<RaceSnapshot> {
        if !self.running {
            return self.race.as_ref().map(|r| r.get_snapshot());
        }

        let now = Instant::now();
        let delta = now.duration_since(self.last_tick).as_secs_f32();
        self.last_tick = now;

        // Track tick timing
        let tick_start = Instant::now();

        // Update race
        if let Some(race) = &mut self.race {
            race.update(delta);

            // Check for state transitions
            match race.status {
                RaceStatus::Finished => {
                    self.state = GameState::Results;
                    self.running = false;
                }
                _ => {}
            }
        }

        // Record tick time
        let tick_time = tick_start.elapsed().as_secs_f32() * 1000.0;
        self.tick_times.push(tick_time);
        if self.tick_times.len() > 60 {
            self.tick_times.remove(0);
        }

        self.race.as_ref().map(|r| r.get_snapshot())
    }

    /// Get current race snapshot
    pub fn get_snapshot(&self) -> Option<RaceSnapshot> {
        self.race.as_ref().map(|r| r.get_snapshot())
    }

    /// Get race results
    pub fn get_results(&self) -> Option<Vec<RaceResult>> {
        self.race.as_ref().map(|r| r.finish_order.clone())
    }

    /// Get server statistics
    pub fn get_stats(&self) -> ServerStats {
        let avg_tick_time = if self.tick_times.is_empty() {
            0.0
        } else {
            self.tick_times.iter().sum::<f32>() / self.tick_times.len() as f32
        };

        ServerStats {
            tick_rate: self.tick_rate,
            avg_tick_time_ms: avg_tick_time,
            runner_count: self.race.as_ref().map(|r| r.runners.len() as u32).unwrap_or(0),
            game_state: self.state,
        }
    }

    /// Get current game state
    pub fn get_state(&self) -> GameState {
        self.state
    }

    /// Reset to idle state
    pub fn reset(&mut self) {
        self.state = GameState::Idle;
        self.race = None;
        self.running = false;
        self.tick_times.clear();
    }

    /// Pause the simulation
    pub fn pause(&mut self) {
        self.running = false;
    }

    /// Resume the simulation
    pub fn resume(&mut self) {
        if self.state == GameState::Racing {
            self.running = true;
            self.last_tick = Instant::now();
        }
    }

    /// Check if server is running
    pub fn is_running(&self) -> bool {
        self.running
    }
}

impl Default for GameServer {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe game server wrapper for use with Tauri state
pub type SharedGameServer = Arc<RwLock<GameServer>>;

/// Create a new shared game server
pub fn create_shared_server() -> SharedGameServer {
    Arc::new(RwLock::new(GameServer::new()))
}
