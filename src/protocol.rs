use std::sync::Arc;

use serde::{Serialize, Deserialize};
use tokio::sync::mpsc;
use uuid::Uuid;
use warp::ws::Message;

use crate::game_state::GameState;

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum ClientProtocol {
    HostGame { nickname: String },
    JoinGame { id: Uuid, nickname: String, player_id: Option<Uuid>, player_secret: Option<Uuid> },
    SendChat { message: String },
    StartGame,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum ServerProtocol {
    SetIdentifiers { player_id: Uuid, game_id: Uuid, secret: Uuid },
    Alert { message: String },
    SetRole { role: PlayerType },
    PlayerList { players: Vec<PlayerItem> },
    SetGameState { state: GameStatus },
    ReceiveChat { name: String, message: String },
}

#[derive(Serialize)]
pub enum GameStatus {
    Lobby,
    InGame,
    Ended
}

#[derive(Clone, Copy, Serialize)]
pub enum PlayerType {
    Liberal,
    Facist,
    Hitler
}

#[derive(Serialize)]
pub struct PlayerItem {
    pub id: Uuid,
    pub name: String
}

pub struct PlayerConnection {
    pub tx: Arc<mpsc::UnboundedSender<Result<Message, warp::Error>>>,
    pub connected: bool
}

impl PlayerConnection {
    pub fn new(ptx: Arc<mpsc::UnboundedSender<Result<Message, warp::Error>>>) -> PlayerConnection {
        PlayerConnection { tx: ptx, connected: true }
    }

    pub fn send(&self, message: &ServerProtocol) {
        if let Err(e) = self.tx.send(Ok(Message::text(serde_json::to_string(message).unwrap()))) {
            eprintln!("error sending message: {}", e);
        }
    }
}

impl GameState {
    pub fn send_to_all(&self, message: &ServerProtocol) {
        let serialized_msg = serde_json::to_string(message).unwrap();

        self.players.values().for_each(|state| {
            if let Err(e) = state.conn.tx.send(Ok(Message::text(serialized_msg.clone()))) {
                eprintln!("error sending all message: {}", e);
            }
        });
    }
}