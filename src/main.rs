use std::{collections::HashMap, sync::{Arc, RwLock}, time::{Duration, SystemTime}};

use game_state::{CardColor, GameState, ChatLine};
use protocol::{ClientProtocol, PlayerConnection, ServerProtocol};
use tokio::{sync::mpsc, time};
use tokio_stream::wrappers::UnboundedReceiverStream;
use uuid::Uuid;
use warp::{Filter, ws::{WebSocket}};
use futures::{FutureExt, StreamExt};

mod protocol;
mod game_state;

type GlobalState = Arc<RwLock<HashMap<uuid::Uuid, Arc<RwLock<GameState>>>>>;

fn cleanup_global_state(state: &GlobalState) {
    let threshold = SystemTime::now() - Duration::from_secs(5 * 60);
    state.write().unwrap().retain(|_, map| {
        let data = map.read().unwrap();
        if let Some(timeout) = data.timeout {
            if timeout < threshold {
                if !data.conn.values().any(|val| val.connected) {
                    return false
                }
            }
        }
        true
    });
}

#[tokio::main]
async fn main() {
    let orig_global_state = GlobalState::default();
    let state_ref = orig_global_state.clone();
    let global_state = warp::any().map(move || orig_global_state.clone());

    let ws_route = warp::path("ws").and(warp::ws()).and(global_state).map(|ws: warp::ws::Ws, state: GlobalState| {
        ws.on_upgrade(|socket| ws_connect(socket, state))
    });
    let game_route = warp::path!("game" / String).map(|_| ()).untuple_one().and(warp::get()).and(warp::fs::file("frontend/build/index.html"));
    let static_route = warp::any().and(warp::get()).and(warp::fs::dir("frontend/build"));

    let routes = ws_route.or(game_route).or(static_route);

    // game cleanup routine
    let mut interval = time::interval(Duration::from_secs(5 * 60));
    tokio::spawn(async move {
        interval.tick().await;
        loop {
            interval.tick().await;
            cleanup_global_state(&state_ref);
        }
    });

    // websocket server
    let port = std::env::var("PORT").unwrap_or("8000".into()).parse::<u16>().unwrap_or(8000);
    println!("Started server on port {}....", port);
    warp::serve(routes).run(([0, 0, 0, 0], port)).await;
}

async fn ws_connect(ws: WebSocket, state: GlobalState) {
    cleanup_global_state(&state);

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
                        let mut conn = PlayerConnection::new(ptx.clone());
                        if match current_game {
                            Some(game_uuid) => {
                                let mut found_game = false;
                                if let Some(game_state) = state.read().unwrap().get(&game_uuid) {
                                    if game_state.read().unwrap().is_in_game() {
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
                                let mut new_gamestate = GameState::new();
                                let player_uuid = Uuid::new_v4();
                                let secret = Uuid::new_v4();
                                current_game = Some(Uuid::new_v4());
                                current_player = Some(player_uuid);
                                conn.secret = Some(secret);
                                conn.name = Some(nickname.clone());
                                conn.send(&ServerProtocol::SetIdentifiers { player_id: player_uuid, game_id: current_game.unwrap(), secret });
                                new_gamestate.add_player(player_uuid, conn);
                                new_gamestate.send_game_state(player_uuid);
                                state.write().unwrap().insert(current_game.unwrap(), Arc::new(RwLock::new(new_gamestate)));
                            }
                        }
                    }
                    ClientProtocol::JoinGame { id, nickname, player_id, player_secret} => {
                        let mut conn = PlayerConnection::new(ptx.clone());
                        conn.name = Some(nickname);
                        conn.secret = player_secret;
                        if let Some(game_state) = state.read().unwrap().get(&id) {
                            if let Some(old_player_id) = player_id {
                                let mut state = game_state.write().unwrap();
                                state.timeout = None;
                                if let Some(real_player_secret) = state.get_player_secret(&old_player_id) {
                                    if Some(real_player_secret) == player_secret {
                                        current_game = Some(id);
                                        current_player = Some(old_player_id);
                                        if state.add_player(old_player_id, conn) {
                                            state.broadcast_game_state();
                                        }
                                        else {
                                            PlayerConnection::new(ptx.clone()).send(&ServerProtocol::Alert { message: "This game has already started!".into() });
                                        }
                                    }
                                    else {
                                        conn.send(&ServerProtocol::Alert { message: "Invalid player secret passed to server!".into() });
                                    }
                                }
                                else {
                                    conn.send(&ServerProtocol::Alert { message: "The player you are trying to join as does not exist!".into() });
                                }
                            }
                            else {
                                let player_id = player_id.unwrap_or_else(|| {Uuid::new_v4() });
                                let secret = player_secret.unwrap_or_else(|| { Uuid::new_v4() });
                                let data = &mut game_state.write().unwrap();
                                conn.secret = Some(secret);
                                if data.add_player(player_id, conn) {
                                    current_game = Some(id);
                                    current_player = Some(player_id);
                                    
                                    // notify players of successful join
                                    data.conn.get(&player_id).unwrap().send(&ServerProtocol::SetIdentifiers { player_id, game_id: id, secret });
                                    data.broadcast_game_state();
                                }
                                else {
                                    PlayerConnection::new(ptx.clone()).send( &ServerProtocol::Alert { message: "This game has already started!".into() });
                                }
                            }
                        }
                        else {
                            conn.send(&ServerProtocol::Alert { message: "The game that you are looking for does not exist!".into() });
                        }
                    },
                    ClientProtocol::StartGame => {
                        if !game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.start(*pid)
                        }) {
                            let conn = PlayerConnection::new(ptx.clone());
                            conn.send(&ServerProtocol::Alert { message: "You are not currently in a game!".into() });
                        }
                    },
                    ClientProtocol::SendChat { message } => {
                        if let Some(game) = current_game {
                            if let Some(state) = state.read().unwrap().get(&game) {
                                if let Some(player) = current_player {
                                    let state = &mut state.write().unwrap();
                                    state.add_chat(ChatLine { id: Some(player), message: message.clone() });
                                }
                            }
                        }
                    },
                    ClientProtocol::ChooseChancellor { player } => {
                        game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.choose_chancellor(*pid, player)
                        });
                    }
                    ClientProtocol::VoteChancellor { vote } => {
                        game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.vote_chancellor(*pid, vote)
                        });
                    },
                    ClientProtocol::PickCard { color } => {
                        game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.pick_card(*pid, if color { CardColor::Facist } else { CardColor::Liberal })
                        });
                    },
                    ClientProtocol::VetoCard => {
                        game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.veto(*pid)
                        });
                    },
                    ClientProtocol::PresidentialPower { player } => {
                        game_state_wrapper(&state, &current_game, &current_player, &|gs: &mut GameState, pid| {
                            gs.execute_presidential_power(*pid, player)
                        });
                    },
                    ClientProtocol::GetChatLog => {
                        if let Some(game) = current_game {
                            if let Some(state) = state.read().unwrap().get(&game) {
                                let log = &state.read().unwrap().chat_log;
                                PlayerConnection::new(ptx.clone()).send(&ServerProtocol::ChatLog { log });
                            }
                        }
                    },
                    ClientProtocol::Leave => {
                        if let Some(game) = current_game {
                            if let Some(state) = state.read().unwrap().get(&game) {
                                if let Some(player) = current_player {
                                    let state = &mut state.write().unwrap();
                                    state.delete_player(player);
                                    state.broadcast_game_state();
                                }
                                current_game = None;
                                current_player = None;
                            }
                        }
                    },
                }
            }
        }
    }

    // disconnect
    if let Some(game_uuid) = current_game {
        let mut remove_game = false;

        if let Some(player_uuid) = current_player {
            if let Some(game) = state.read().unwrap().get(&game_uuid) {
                let game = &mut game.write().unwrap();
                game.remove_player(player_uuid);
                game.broadcast_game_state();
                remove_game = !game.has_connected_players();
            }
        }

        if remove_game {
            if let Some(game) = state.read().unwrap().get(&game_uuid) {
                game.write().unwrap().timeout = Some(SystemTime::now());
            }
        }
    }
}

fn game_state_wrapper(state: &GlobalState, game_id: &Option<Uuid>, player_id: &Option<Uuid>, func: &dyn Fn(&mut GameState, &Uuid) -> Result<(), &'static str>) -> bool {
    if let Some(game_id) = game_id {
        if let Some(player_id) = player_id {
            if let Some(state) = state.read().unwrap().get(game_id) {
                let state = &mut state.write().unwrap();
                match func(state, player_id) {
                    Ok(_) => {
                        state.broadcast_game_state();
                    },
                    Err(str) => {
                        state.conn.get(&player_id).unwrap().send(&ServerProtocol::Alert { message: str.into() });
                    }
                }
                return true
            }
        }
    }
    false
}