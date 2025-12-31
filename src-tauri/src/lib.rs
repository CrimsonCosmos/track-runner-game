//! Track Runner Game - Tauri Backend
//!
//! Provides the game server for local AI mode and commands for frontend communication.

mod game_server;

use game_server::race::{RaceConfig, RaceSnapshot, RaceResult};
use game_server::simulation::{GameServer, GameState, ServerStats};
use std::sync::Mutex;
use tauri::State;

/// Initialize a new race with the given configuration
#[tauri::command]
fn init_race(
    server: State<'_, Mutex<GameServer>>,
    runner_count: Option<u32>,
    time_scale: Option<f32>,
) -> Result<(), String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;

    let config = RaceConfig {
        runner_count: runner_count.unwrap_or(100),
        time_scale: time_scale.unwrap_or(10.0),
        ..Default::default()
    };

    let runner_count = config.runner_count;
    server.init_race(config);
    log::info!("Race initialized with {} runners", runner_count);
    Ok(())
}

/// Start the race countdown
#[tauri::command]
fn start_race(server: State<'_, Mutex<GameServer>>) -> Result<(), String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;
    server.start_race();
    log::info!("Race started");
    Ok(())
}

/// Perform a simulation tick and return the current state
#[tauri::command]
fn tick(server: State<'_, Mutex<GameServer>>) -> Result<Option<RaceSnapshot>, String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;
    Ok(server.tick())
}

/// Get current race snapshot without advancing simulation
#[tauri::command]
fn get_snapshot(server: State<'_, Mutex<GameServer>>) -> Result<Option<RaceSnapshot>, String> {
    let server = server.lock().map_err(|e| e.to_string())?;
    Ok(server.get_snapshot())
}

/// Get race results
#[tauri::command]
fn get_results(server: State<'_, Mutex<GameServer>>) -> Result<Option<Vec<RaceResult>>, String> {
    let server = server.lock().map_err(|e| e.to_string())?;
    Ok(server.get_results())
}

/// Get server statistics
#[tauri::command]
fn get_stats(server: State<'_, Mutex<GameServer>>) -> Result<ServerStats, String> {
    let server = server.lock().map_err(|e| e.to_string())?;
    Ok(server.get_stats())
}

/// Get current game state
#[tauri::command]
fn get_game_state(server: State<'_, Mutex<GameServer>>) -> Result<GameState, String> {
    let server = server.lock().map_err(|e| e.to_string())?;
    Ok(server.get_state())
}

/// Pause the simulation
#[tauri::command]
fn pause_race(server: State<'_, Mutex<GameServer>>) -> Result<(), String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;
    server.pause();
    log::info!("Race paused");
    Ok(())
}

/// Resume the simulation
#[tauri::command]
fn resume_race(server: State<'_, Mutex<GameServer>>) -> Result<(), String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;
    server.resume();
    log::info!("Race resumed");
    Ok(())
}

/// Reset to idle state
#[tauri::command]
fn reset_race(server: State<'_, Mutex<GameServer>>) -> Result<(), String> {
    let mut server = server.lock().map_err(|e| e.to_string())?;
    server.reset();
    log::info!("Race reset");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(GameServer::new()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            log::info!("Track Runner game server initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_race,
            start_race,
            tick,
            get_snapshot,
            get_results,
            get_stats,
            get_game_state,
            pause_race,
            resume_race,
            reset_race,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
