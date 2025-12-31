//! Runner - Individual runner state and behavior
//!
//! Each runner has position, speed, and race data (split times).
//! The simulation updates all runners each tick.

use serde::{Deserialize, Serialize};

/// Split times for a 5K race (5 x 1km splits)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitTimes {
    pub splits: [f32; 5],
    pub final_time: f32,
}

impl SplitTimes {
    /// Generate split times for a given finish time with slight variation
    pub fn from_finish_time(finish_time: f32) -> Self {
        let km_time = finish_time / 5.0;
        let variation = || 0.98 + rand::random::<f32>() * 0.04;

        Self {
            splits: [
                km_time * variation(),
                km_time * 2.0 * variation(),
                km_time * 3.0 * variation(),
                km_time * 4.0 * variation(),
                finish_time,
            ],
            final_time: finish_time,
        }
    }

    /// Get target speed at a given distance
    pub fn get_target_speed(&self, distance: f32, time_scale: f32) -> f32 {
        let segment = (distance / 1000.0).floor().min(4.0) as usize;
        let time_at_start = if segment == 0 { 0.0 } else { self.splits[segment - 1] };
        let time_at_end = self.splits[segment];
        let segment_time = time_at_end - time_at_start;

        (1000.0 / segment_time) / time_scale
    }
}

/// Runner state flags
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct RunnerFlags {
    pub finished: bool,
    pub squished: bool,
}

/// Complete state for a single runner
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerState {
    /// Unique runner ID
    pub id: u32,
    /// Runner name
    pub name: String,
    /// Distance traveled along track (meters)
    pub distance: f32,
    /// Lane position (offset from inside edge)
    pub lane_position: f32,
    /// Current speed (m/s)
    pub current_speed: f32,
    /// Target speed (m/s)
    pub target_speed: f32,
    /// Animation phase (0-1, repeating)
    pub animation_phase: f32,
    /// Stride multiplier for animation variation
    pub stride_multiplier: f32,
    /// Split times for pacing
    pub split_times: SplitTimes,
    /// Status flags
    pub flags: RunnerFlags,
}

impl RunnerState {
    /// Create a new runner with given finish time
    pub fn new(id: u32, name: String, finish_time: f32) -> Self {
        Self {
            id,
            name,
            distance: 0.0,
            lane_position: 1.0,
            current_speed: 0.0,
            target_speed: 0.0,
            animation_phase: rand::random::<f32>(),
            stride_multiplier: 0.85 + rand::random::<f32>() * 0.3,
            split_times: SplitTimes::from_finish_time(finish_time),
            flags: RunnerFlags::default(),
        }
    }

    /// Reset runner to starting position
    pub fn reset(&mut self, start_distance: f32, start_lane: f32) {
        self.distance = start_distance;
        self.lane_position = start_lane;
        self.current_speed = 0.0;
        self.target_speed = 0.0;
        self.animation_phase = rand::random::<f32>();
        self.flags = RunnerFlags::default();
    }
}

/// Runner simulation logic
pub struct Runner;

impl Runner {
    /// Constants
    const ACCELERATION_RATE: f32 = 2.0;
    const BASE_ANIMATION_SPEED: f32 = 5000.0 / 600.0;
    const COOLDOWN_FACTOR: f32 = 0.5;
    const DRIFT_LEFT_SPEED: f32 = 0.15;
    const MIN_LANE: f32 = 0.75;
    const MAX_LANE: f32 = 2.0;

    /// Update a single runner for one tick
    pub fn update(
        state: &mut RunnerState,
        delta: f32,
        time_scale: f32,
        race_distance: f32,
    ) {
        // Check if finished
        if !state.flags.finished && state.distance >= race_distance {
            state.flags.finished = true;
        }

        // Calculate target speed
        if state.flags.finished {
            let base_speed = state.split_times.get_target_speed(race_distance - 1.0, time_scale);
            state.target_speed = base_speed * Self::COOLDOWN_FACTOR;
        } else {
            state.target_speed = state.split_times.get_target_speed(state.distance, time_scale);
        }

        // Smooth acceleration
        let accel = Self::ACCELERATION_RATE * delta;
        if state.current_speed < state.target_speed {
            state.current_speed = (state.current_speed + accel).min(state.target_speed);
        } else if state.current_speed > state.target_speed {
            state.current_speed = (state.current_speed - accel).max(state.target_speed);
        }

        // Move forward
        state.distance += state.current_speed * delta;

        // Update animation phase
        let anim_scale = state.current_speed / Self::BASE_ANIMATION_SPEED;
        state.animation_phase += delta * anim_scale.max(0.3) * state.stride_multiplier;
        state.animation_phase %= 1.0;

        // Lane drift toward inside
        if state.lane_position > Self::MIN_LANE {
            let drift = Self::DRIFT_LEFT_SPEED * delta * state.lane_position;
            state.lane_position = (state.lane_position - drift).max(Self::MIN_LANE);
        }
    }
}

/// Compact runner state for network/IPC transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerSnapshot {
    pub id: u32,
    pub distance: f32,
    pub lane_position: f32,
    pub speed: f32,
    pub animation_phase: f32,
    pub finished: bool,
}

impl From<&RunnerState> for RunnerSnapshot {
    fn from(state: &RunnerState) -> Self {
        Self {
            id: state.id,
            distance: state.distance,
            lane_position: state.lane_position,
            speed: state.current_speed,
            animation_phase: state.animation_phase,
            finished: state.flags.finished,
        }
    }
}
