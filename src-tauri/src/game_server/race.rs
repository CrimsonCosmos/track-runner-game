//! Race - Race configuration and state management
//!
//! Handles race setup, timing, and finish detection.

use serde::{Deserialize, Serialize};
use crate::game_server::runner::{RunnerState, Runner, RunnerSnapshot};

/// Race configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaceConfig {
    /// Total race distance in meters
    pub distance: f32,
    /// Number of runners
    pub runner_count: u32,
    /// Time scale factor (higher = faster simulation)
    pub time_scale: f32,
    /// Starting formation spread
    pub formation_spread: f32,
}

impl Default for RaceConfig {
    fn default() -> Self {
        Self {
            distance: 5000.0,
            runner_count: 100,
            time_scale: 10.0,
            formation_spread: 3.0,
        }
    }
}

/// Race status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RaceStatus {
    NotStarted,
    Countdown,
    Racing,
    Finished,
}

/// Race timing and results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaceResult {
    pub runner_id: u32,
    pub runner_name: String,
    pub finish_time: f32,
    pub position: u32,
}

/// Complete race state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Race {
    /// Race configuration
    pub config: RaceConfig,
    /// Current race status
    pub status: RaceStatus,
    /// All runners in the race
    pub runners: Vec<RunnerState>,
    /// Elapsed race time (in-game seconds)
    pub elapsed_time: f32,
    /// Countdown remaining (seconds)
    pub countdown: f32,
    /// Finish order (runner IDs)
    pub finish_order: Vec<RaceResult>,
}

impl Race {
    /// Create a new race with the given configuration
    pub fn new(config: RaceConfig) -> Self {
        Self {
            config,
            status: RaceStatus::NotStarted,
            runners: Vec::new(),
            elapsed_time: 0.0,
            countdown: 3.0,
            finish_order: Vec::new(),
        }
    }

    /// Generate runners with realistic 5K finish times
    pub fn generate_runners(&mut self) {
        self.runners.clear();

        // Generate finish times with realistic distribution
        // Elite: 13-14 min, Good: 15-18 min, Average: 19-25 min, Slow: 26-35 min
        let finish_times = Self::generate_finish_times(self.config.runner_count as usize);

        for (i, finish_time) in finish_times.into_iter().enumerate() {
            let name = format!("Runner {}", i + 1);
            self.runners.push(RunnerState::new(i as u32, name, finish_time));
        }
    }

    /// Generate realistic 5K finish times
    fn generate_finish_times(count: usize) -> Vec<f32> {
        let mut times = Vec::with_capacity(count);

        for i in 0..count {
            // Create a bell curve distribution around 20 minutes
            let base = match i % 10 {
                0 => 780.0 + rand::random::<f32>() * 60.0,   // 13:00-14:00 (elite)
                1..=2 => 900.0 + rand::random::<f32>() * 180.0, // 15:00-18:00 (good)
                3..=6 => 1140.0 + rand::random::<f32>() * 360.0, // 19:00-25:00 (average)
                _ => 1560.0 + rand::random::<f32>() * 540.0,  // 26:00-35:00 (slow)
            };
            times.push(base);
        }

        // Sort by finish time (fastest first)
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        times
    }

    /// Set up starting positions in a formation
    pub fn setup_starting_positions(&mut self) {
        let spread = self.config.formation_spread;

        for (i, runner) in self.runners.iter_mut().enumerate() {
            // Stagger runners in rows
            let row = i / 10;
            let col = i % 10;

            let start_distance = -(row as f32) * spread;
            let lane = 0.8 + (col as f32) * 0.15 + rand::random::<f32>() * 0.05;

            runner.reset(start_distance, lane);
        }
    }

    /// Start countdown
    pub fn start_countdown(&mut self) {
        self.status = RaceStatus::Countdown;
        self.countdown = 3.0;
    }

    /// Update race state
    pub fn update(&mut self, delta: f32) {
        match self.status {
            RaceStatus::NotStarted => {}

            RaceStatus::Countdown => {
                self.countdown -= delta;
                if self.countdown <= 0.0 {
                    self.status = RaceStatus::Racing;
                    self.countdown = 0.0;
                }
            }

            RaceStatus::Racing => {
                self.elapsed_time += delta * self.config.time_scale;

                // Update all runners
                for runner in &mut self.runners {
                    if !runner.flags.finished {
                        Runner::update(
                            runner,
                            delta,
                            self.config.time_scale,
                            self.config.distance,
                        );

                        // Check for finish
                        if runner.flags.finished && !self.finish_order.iter().any(|r| r.runner_id == runner.id) {
                            self.finish_order.push(RaceResult {
                                runner_id: runner.id,
                                runner_name: runner.name.clone(),
                                finish_time: self.elapsed_time,
                                position: (self.finish_order.len() + 1) as u32,
                            });
                        }
                    }
                }

                // Check if all runners finished
                if self.finish_order.len() == self.runners.len() {
                    self.status = RaceStatus::Finished;
                }
            }

            RaceStatus::Finished => {
                // Still update for cooldown animation
                for runner in &mut self.runners {
                    Runner::update(
                        runner,
                        delta,
                        self.config.time_scale,
                        self.config.distance,
                    );
                }
            }
        }
    }

    /// Get compact snapshot for IPC transfer
    pub fn get_snapshot(&self) -> RaceSnapshot {
        RaceSnapshot {
            status: self.status,
            elapsed_time: self.elapsed_time,
            countdown: self.countdown,
            runners: self.runners.iter().map(RunnerSnapshot::from).collect(),
            finisher_count: self.finish_order.len() as u32,
        }
    }

    /// Get current leader
    pub fn get_leader(&self) -> Option<&RunnerState> {
        self.runners.iter().max_by(|a, b| {
            a.distance.partial_cmp(&b.distance).unwrap()
        })
    }

    /// Get runner by ID
    pub fn get_runner(&self, id: u32) -> Option<&RunnerState> {
        self.runners.iter().find(|r| r.id == id)
    }
}

/// Compact race snapshot for network/IPC transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaceSnapshot {
    pub status: RaceStatus,
    pub elapsed_time: f32,
    pub countdown: f32,
    pub runners: Vec<RunnerSnapshot>,
    pub finisher_count: u32,
}
