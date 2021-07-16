use std::{collections::HashMap, sync::Arc};

use serde::{Serialize, Deserialize};
use tokio::sync::mpsc;
use uuid::Uuid;
use warp::ws::Message;

use crate::game_state::GameStatePlayerView;

pub type ConnectionState = HashMap<Uuid, PlayerConnection>;

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum ClientProtocol {
    HostGame { nickname: String },
    JoinGame { id: Uuid, nickname: String, player_id: Option<Uuid>, player_secret: Option<Uuid> },
    SendChat { message: String },
    StartGame,
    ChooseChancellor { player: Uuid },
    VoteChancellor { vote: bool },
    PickCard { color: bool },
    VetoCard,
}

#[derive(Serialize)]
struct PlayerData {
    id: Uuid,
    role: Option<PlayerType>,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum ServerProtocol<'a> {
    SetIdentifiers { player_id: Uuid, game_id: Uuid, secret: Uuid },
    Alert { message: String },
    ReceiveChat { name: String, message: String },
    GameState { state: GameStatePlayerView<'a> },
}

#[derive(Clone, Copy, Serialize)]
pub enum PlayerType {
    Liberal,
    Facist,
    Hitler
}

pub struct PlayerConnection {
    pub name: Option<String>,
    pub secret: Option<Uuid>,
    pub tx: Arc<mpsc::UnboundedSender<Result<Message, warp::Error>>>,
    pub connected: bool
}

impl PlayerConnection {
    pub fn new(ptx: Arc<mpsc::UnboundedSender<Result<Message, warp::Error>>>) -> PlayerConnection {
        PlayerConnection { tx: ptx, connected: true, name: None, secret: None }
    }

    pub fn send(&self, message: &ServerProtocol) {
        if let Err(e) = self.tx.send(Ok(Message::text(serde_json::to_string(message).unwrap()))) {
            eprintln!("error sending message: {}", e);
        }
    }
}

pub fn send_to_all(conn: &ConnectionState, message: &ServerProtocol) {
    let serialized_msg = serde_json::to_string(message).unwrap();

    conn.values().for_each(|conn| {
        if let Err(e) = conn.tx.send(Ok(Message::text(serialized_msg.clone()))) {
            eprintln!("error sending all message: {}", e);
        }
    });
}