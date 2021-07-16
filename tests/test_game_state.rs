use core::panic;
use std::{sync::Arc};
use serde::Deserialize;

#[cfg(test)]

use secrethitler::game_state::GameState;
use secrethitler::{game_state::{GameStatePlayerView, TurnPhase}, protocol::PlayerConnection};
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Deserialize)]
struct ClientState {
    turn_phase: TurnPhase,
    turn_order: Vec<Uuid>
}

fn get_state_snapshot(state: &GameState, player: &Uuid) -> ClientState {
    let serialized = serde_json::to_string(&GameStatePlayerView { state, player: *player }).unwrap();
    return serde_json::from_str(&serialized).unwrap();
}

#[test]
fn test_game_lobby_init() {
    let (ptx, _) = mpsc::unbounded_channel();
    let ptx = Arc::new(ptx);

    // start game with 5 players
    let mut state = GameState::new();
    let mut ids = vec![];
    for _ in 0..5 {
        ids.push(Uuid::new_v4());
    }
    ids.iter().for_each(|id| {
        state.add_player(*id, PlayerConnection::new(ptx.clone()));
    });

    // should be in lobby
    assert!(matches!(get_state_snapshot(&state, &ids[0]).turn_phase, TurnPhase::Lobby));

    // start game
    assert!(matches!(state.start(ids[1]), Err(_)));
    assert!(matches!(state.start(Uuid::new_v4()), Err(_)));

    assert!(matches!(state.start(ids[0]), Ok(())));

    assert!(matches!(get_state_snapshot(&state, &ids[0]).turn_phase, TurnPhase::Electing));

    // choose chancellor
    if let Err(e) = state.choose_chancellor(get_state_snapshot(&state, &ids[3]).turn_order[0], ids[1]) {
        panic!("failed to choose chancellor: {}", e);
    }
    assert!(matches!(get_state_snapshot(&state, &ids[0]).turn_phase, TurnPhase::Voting));

    // vote yes
    ids.iter().for_each(|id| {
        if let Err(e) = state.vote_chancellor(*id, true) {
            panic!("failed to vote for chancellor: {}", e);
        }
    });

    // choose card
    assert!(matches!(get_state_snapshot(&state, &ids[0]).turn_phase, TurnPhase::PresidentSelect));
}