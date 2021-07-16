use std::{collections::HashMap, io::{self, Write}, str::FromStr, sync::{Arc, RwLock}};

use game_state::{GameState, build_gamestate};
use protocol::{ClientProtocol, GameStatus, PlayerConnection, PlayerItem, ServerProtocol};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use uuid::Uuid;
use warp::{Filter, ws::{Message, WebSocket}};
use futures::{FutureExt, SinkExt, StreamExt};

mod protocol;
mod game_state;

type GlobalState = Arc<RwLock<HashMap<uuid::Uuid, Arc<RwLock<GameState>>>>>;

#[tokio::main]
async fn main() {
    let global_state = GlobalState::default();
    let global_state = warp::any().map(move || global_state.clone());

    let routes = warp::path("ws").and(warp::ws()).and(global_state).map(|ws: warp::ws::Ws, state: GlobalState| {
        ws.on_upgrade(|socket| ws_connect(socket, state))
    }).or(warp::any().and(warp::get()).and(warp::fs::dir("frontend/build")));

    let port = std::env::var("PORT").unwrap_or("8000".into()).parse::<u16>().unwrap_or(8000);
    println!("Started server on port {}....", port);
    warp::serve(routes).run(([0, 0, 0, 0], port)).await;
}

async fn ws_connect(ws: WebSocket, state: GlobalState) {
    let (tx, mut rx) = ws.split();
    
    let (ptx, prx) = mpsc::unbounded_channel();
    let ptx = Arc::new(ptx);
    let prx = UnboundedReceiverStream::new(prx);
    tokio::task::spawn(prx.forward(tx).map(|result| {
        if let Err(e) = result {
            eprintln!("websocket send error: {}", e);
        }
    }));

    let mut current_game: Option<Uuid> = Option::None;
    let mut current_player: Option<Uuid> = Option::None;

    while let Some(Ok(result)) = rx.next().await {
        if let Ok(raw) = result.to_str() {
            if let Ok::<ClientProtocol, serde_json::Error>(msg) = serde_json::from_str(raw) {
                match msg {
                    ClientProtocol::HostGame { nickname } => {
                        let conn = PlayerConnection::new(ptx.clone());
                        if match current_game {
                            Some(game_uuid) => {
                                let mut found_game = false;
                                if let Some(game_state) = state.read().unwrap().get(&game_uuid) {
                                    if matches!(game_state.read().unwrap().status, protocol::GameStatus::InGame) {
                                        conn.send(&ServerProtocol::Alert { message: "You cannot join another game while you are currently in a game!".into() });
                                        found_game = true;
                                    }
                                }
                                !found_game
                            }
                            None => true
                        } {
                            if nickname.trim().len() <= 0 {
                                conn.send(&ServerProtocol::Alert { message: "Your nickname cannot be empty.".into() });
                            }
                            else {
                                let (new_gamestate, player_uuid, secret) = build_gamestate(nickname, conn);
                                current_game = Some(Uuid::new_v4());
                                current_player = Some(player_uuid);
                                state.write().unwrap().insert(current_game.unwrap(), Arc::new(RwLock::new(new_gamestate)));
                                PlayerConnection::new(ptx.clone()).send(&ServerProtocol::SetIdentifiers { player_id: player_uuid, game_id: current_game.unwrap(), secret });
                            }
                        }
                    }
                    ClientProtocol::JoinGame { id, nickname, player_id, player_secret} => {
                        let conn = PlayerConnection::new(ptx.clone());
                        if let Some(game_state) = state.read().unwrap().get(&id) {
                            if let Some(old_player_id) = player_id {
                                let mut state = game_state.write().unwrap();
                                let is_in_game = matches!(state.status, GameStatus::InGame);
                                let player_list = &mut state.players;
                                if player_list.contains_key(&old_player_id) {
                                    if let Some(player_secret) = player_secret {
                                        let players = player_list.iter().map(|(k, v)| PlayerItem { id: *k, name: v.name.clone() }).collect();
                                        let mut player = player_list.get_mut(&old_player_id).unwrap();
                                        if player.secret == player_secret {
                                            current_game = Some(id);
                                            current_player = Some(old_player_id);
                                            conn.send(&ServerProtocol::PlayerList { players });
                                            if is_in_game {
                                                conn.send(&ServerProtocol::SetGameState { state: GameStatus::InGame });
                                            }
                                            player.conn = conn;
                                        }
                                        else {
                                            conn.send(&ServerProtocol::Alert { message: "Invalid player secret passed to server!".into() });
                                        }
                                    }
                                    else {
                                        conn.send(&ServerProtocol::Alert { message: "No player secret passed to server!".into() });
                                    }
                                }
                                else {
                                    conn.send(&ServerProtocol::Alert { message: "The player you are trying to join as does not exist!".into() });
                                }
                            }
                            else {
                                match game_state.write().unwrap().add_player(nickname, conn) {
                                    Ok((player_id, secret)) => {
                                        current_game = Some(id);
                                        current_player = Some(player_id);
                                        PlayerConnection::new(ptx.clone()).send(&ServerProtocol::SetIdentifiers { player_id, game_id: id, secret: secret });
                                    },
                                    Err(msg) => {
                                        PlayerConnection::new(ptx.clone()).send(&ServerProtocol::Alert { message: msg });
                                    }
                                }
                            }
                        }
                        else {
                            conn.send(&ServerProtocol::Alert { message: "The game that you are looking for does not exist!".into() });
                        }
                    },
                    ClientProtocol::StartGame => {
                        if let Some(game) = current_game {
                            if let Some(player) = current_player {
                                let state_map = state.read().unwrap();
                                let mut current_game_state = state_map.get(&game).unwrap().write().unwrap();
                                current_game_state.start(player);
                            }
                        }
                        else {
                            let conn = PlayerConnection::new(ptx.clone());
                            conn.send(&ServerProtocol::Alert { message: "You are not currently in a game!".into() });
                        }
                    },
                    ClientProtocol::SendChat { message } => {
                        if let Some(game) = current_game {
                            if let Some(state) = state.read().unwrap().get(&game) {
                                if let Some(player) = current_player {
                                    let state = &state.read().unwrap();
                                    if let Some(player) = state.players.get(&player) {
                                        state.send_to_all(&ServerProtocol::ReceiveChat { name: player.name.clone(), message });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // disconnect
    if let Some(game_uuid) = current_game {
        let mut remove_game = false;

        if let Some(player_uuid) = current_player {
            if let Some(game) = state.read().unwrap().get(&game_uuid) {
                let players = &mut game.write().unwrap().players;
                if let Some(plr) = players.get_mut(&player_uuid) {
                    plr.conn.connected = false;
                }
                remove_game = !players.values().any(|plr| plr.conn.connected);
            }
        }

        if remove_game {
            state.write().unwrap().remove(&game_uuid);
        }
    }
}