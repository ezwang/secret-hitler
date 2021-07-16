use futures::stream::SplitSink;
use tokio::sync::mpsc;
use uuid::Uuid;
use rand::{seq::SliceRandom, thread_rng};
use warp::ws::{Message, WebSocket};
use core::fmt;
use std::{collections::HashMap, sync::Arc};

use crate::protocol;
use protocol::{PlayerConnection, ServerProtocol, PlayerType, PlayerItem, GameStatus};

impl fmt::Display for PlayerType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            PlayerType::Liberal => write!(f, "Liberal"),
            PlayerType::Facist => write!(f, "Facist"),
            PlayerType::Hitler => write!(f, "Hitler"),
        }
    }
}

pub struct PlayerState {
    pub name: String,
    pub secret: Uuid,
    role: PlayerType,
    pub conn: PlayerConnection,
}

impl PlayerCommunication for GameState {
    fn send_alert(&self, player: Uuid, msg: String) -> () {
        if let Some(player_state) = self.players.get(&player) {
            player_state.conn.send(&ServerProtocol::Alert { message: msg });
        }
        else {
            eprintln!("could not send message to {}, was not in map", player);
        }
    }

    fn set_own_role(&self, player: Uuid, role: PlayerType) -> () {
        self.players.get(&player).unwrap().conn.send(&ServerProtocol::SetRole { role });
    }

    fn send_players(&self) {
        let player_list: Vec<PlayerItem> = self.players.iter().map(|(id, state)| PlayerItem { id: *id, name: state.name.clone() }).collect();
        self.send_to_all(&ServerProtocol::PlayerList { players: player_list });
    }

    fn start_game(&self) {
        self.send_to_all(&ServerProtocol::SetGameState { state: GameStatus::InGame });
    }
}

trait PlayerCommunication {
    fn send_alert(&self, player: Uuid, msg: String) -> ();
    fn set_own_role(&self, player: Uuid, role: PlayerType) -> ();
    fn send_players(&self);
    fn start_game(&self);
}

pub struct GameState {
    pub status: GameStatus,
    host: Uuid,
    pub players: HashMap<Uuid, PlayerState>,
    liberal_draw_cards: u8,
    facist_draw_cards: u8,
    liberal_policies: u8,
    facist_policies: u8,
}

pub fn build_gamestate(name: String, conn: PlayerConnection) -> (GameState, Uuid, Uuid) {
    let new_uuid: Uuid = Uuid::new_v4();
    let secret = Uuid::new_v4();
    let mut player_map = HashMap::new();
    player_map.insert(new_uuid, PlayerState { name: name.trim().into(), role: PlayerType::Liberal, conn: conn, secret });
    let state = GameState {
        status: GameStatus::Lobby,
        host: new_uuid,
        players: player_map,
        liberal_draw_cards: 6,
        facist_draw_cards: 11,
        liberal_policies: 0,
        facist_policies: 0,
    };
    state.send_players();
    (state, new_uuid, secret)
}

impl GameState {
    pub fn add_player(&mut self, name: String, conn: PlayerConnection) -> Result<(Uuid, Uuid), String> {
        if matches!(self.status, GameStatus::InGame) {
            return Err("This game has already started!".into())
        }

        if matches!(self.status, GameStatus::Ended) {
            return Err("This game has already ended!".into())
        }

        if self.players.values().any(|state| state.name.to_ascii_lowercase() == name.to_ascii_lowercase()) {
            return Err("The nickname you are using is already taken!".into());
        }

        let new_uuid: Uuid = Uuid::new_v4();
        let new_secret: Uuid = Uuid::new_v4();
        self.players.insert(new_uuid, PlayerState {
            name: name.trim().into(),
            role: PlayerType::Liberal,
            conn,
            secret: new_secret,
        });
        self.send_players();
        Ok((new_uuid, new_secret))
    }

    pub fn start(&mut self, player: Uuid) -> bool {
        if player != self.host {
            self.send_alert(player, "Only the host can start the game!".into());
            return false
        }
        if self.players.len() < 5 {
            self.send_alert(player, "There are too few players! You need 5 players to start a game.".into());
            return false
        }
        if self.players.len() > 5 {
            self.send_alert(player, "There are too may players! There can be at most 10 players.".into());
            return false
        }
        let num_facist = match self.players.len() {
            5 => 1,
            6 => 1,
            7 => 2,
            8 => 2,
            9 => 3,
            10 => 3,
            d if d % 2 == 0 => (d - 1) / 2 - 1,
            _ => self.players.len() / 2 - 1
        };
        let mut roles = Vec::new();
        for _ in 0..self.players.len() - num_facist - 1 {
            roles.push(PlayerType::Liberal);
        }
        for _ in 0..num_facist {
            roles.push(PlayerType::Facist);
        }
        roles.push(PlayerType::Hitler);
        let mut rng = thread_rng();
        roles.shuffle(&mut rng);
        for ((_, value), role) in self.players.iter_mut().zip(roles) {
            value.role = role;
        }
        for (player, value) in self.players.iter() {
            self.set_own_role(*player, value.role);
        }
        self.status = GameStatus::InGame;
        self.start_game();
        return true
    }
}