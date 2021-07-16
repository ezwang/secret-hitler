use serde::{Serialize, Deserialize, ser::SerializeMap};
use uuid::Uuid;
use rand::{seq::SliceRandom, thread_rng};
use std::{collections::HashMap, time::SystemTime};

use crate::protocol::{ConnectionState, PlayerConnection, ServerProtocol};

#[derive(Clone, Copy, Serialize)]
pub enum PlayerType {
    Liberal,
    Facist,
    Hitler
}

#[derive(Serialize)]
struct PlayerState {
    role: PlayerType,
    vote: Option<bool>,
    dead: bool
}

#[derive(Serialize)]
struct PartialPlayerState {
    name: String,
    role: Option<PlayerType>,
    vote: Option<bool>,
    dead: bool
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TurnPhase {
    Lobby,
    Ended { winner: CardColor },
    
    Electing,
    Voting,
    PresidentSelect,
    ChancellorSelect,

    PresidentialPower { power: PresidentialPower },
}

#[derive(Serialize, Deserialize)]
pub enum PresidentialPower {
    InvestigateLoyalty,
    CallSpecialElection,
    PolicyPeek,
    Execution,
}

#[derive(PartialEq, Clone, Copy, Serialize, Deserialize)]
pub enum CardColor {
    Facist,
    Liberal
}

pub struct GameState {
    pub conn: ConnectionState,
    pub timeout: Option<SystemTime>,

    players: HashMap<Uuid, PlayerState>,
    liberal_policies: u8,
    facist_policies: u8,
    election_tracker: u8,
    cards: Vec<CardColor>,
    discarded_card: Option<CardColor>,

    turn_phase: TurnPhase,
    turn_counter: usize,
    turn_order: Vec<Uuid>,
    last_president: Option<Uuid>,
    last_chancellor: Option<Uuid>,
    president: Option<Uuid>,
    chancellor: Option<Uuid>,
    host: Option<Uuid>,

    president_veto: bool,
    chancellor_veto: bool,
    investigated: HashMap<Uuid, Vec<Uuid>>,
}

fn shuffle_deck() -> Vec<CardColor> {
    let mut cards = vec![];
    for _ in 0..6 {
        cards.push(CardColor::Liberal);
    }
    for _ in 0..11 {
        cards.push(CardColor::Facist);
    }
    cards.shuffle(&mut thread_rng());
    cards
}


pub struct GameStatePlayerView<'a> {
    pub player: Uuid,
    pub state: &'a GameState
}

impl Serialize for GameStatePlayerView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer {
            let role = self.state.players.get(&self.player).unwrap().role;
            let investigated = vec![];
            let investigated = self.state.investigated.get(&self.player).unwrap_or(&investigated);
            let mut map = serializer.serialize_map(None)?;
            map.serialize_entry("liberal_policies", &self.state.liberal_policies)?;
            map.serialize_entry("facist_policies", &self.state.facist_policies)?;
            map.serialize_entry("election_tracker", &self.state.election_tracker)?;
            map.serialize_entry("liberal_cards", &self.state.cards.iter().filter(|c| matches!(**c, CardColor::Liberal)).count())?;
            map.serialize_entry("facist_cards", &self.state.cards.iter().filter(|c| matches!(**c, CardColor::Facist)).count())?;
            map.serialize_entry("host", &self.state.host)?;
            map.serialize_entry("president", &self.state.president)?;
            map.serialize_entry("last_president", &self.state.last_president)?;
            map.serialize_entry("chancellor", &self.state.chancellor)?;
            map.serialize_entry("last_chancellor", &self.state.last_chancellor)?;
            map.serialize_entry("turn_phase", &self.state.turn_phase)?;
            map.serialize_entry("turn_order", &self.state.turn_order)?;
            map.serialize_entry("players", &self.state.players.iter().map(|(k, v)| {
                (k, PartialPlayerState {
                    name: self.state.conn.get(&k).unwrap().name.clone().unwrap_or_default(),
                    role: if self.player == *k || matches!(role, PlayerType::Facist) || (matches!(role, PlayerType::Hitler) && self.state.players.len() <= 6) || investigated.contains(k) { Some(v.role) } else { None },
                    vote: if matches!(self.state.turn_phase, TurnPhase::Voting) { None } else { v.vote },
                    dead: v.dead
                })
            }).collect::<HashMap<&Uuid, PartialPlayerState>>())?;
            if matches!(self.state.turn_phase, TurnPhase::PresidentSelect | TurnPhase::PresidentialPower { power: PresidentialPower::PolicyPeek }) && Some(self.player) == self.state.president {
                map.serialize_entry("cards", &self.state.cards[self.state.cards.len()-3..self.state.cards.len()])?;
            }
            if matches!(self.state.turn_phase, TurnPhase::ChancellorSelect) && Some(self.player) == self.state.chancellor {
                let mut cards: Vec<CardColor> = self.state.cards[self.state.cards.len()-3..self.state.cards.len()].into();
                let idx = cards.iter().position(|x| Some(*x) == self.state.discarded_card).unwrap();
                cards.remove(idx);
                map.serialize_entry("cards", &cards)?;
            }
            map.end()
        }
}


impl GameState {
    pub fn broadcast_game_state(&self) {
        self.players.keys().for_each(|k| {
            self.send_game_state(*k);
        });
    }

    pub fn send_game_state(&self, player: Uuid) {
        if let Some(conn) = self.conn.get(&player) {
            conn.send(&ServerProtocol::GameState { state: GameStatePlayerView { player, state: self } });
        }
    }

    pub fn is_in_game(&self) -> bool {
        !matches!(self.turn_phase, TurnPhase::Lobby | TurnPhase::Ended { winner: _ })
    }

    pub fn new() -> GameState {
        GameState {
            conn: ConnectionState::default(),

            timeout: None,
            players: HashMap::new(),
            liberal_policies: 0,
            facist_policies: 0,
            election_tracker: 0,
            host: None,
            president: None,
            chancellor: None,
            last_president: None,
            last_chancellor: None,

            turn_order: vec![],
            cards: shuffle_deck(),
            discarded_card: None,
            turn_counter: 0,
            turn_phase: TurnPhase::Lobby,

            president_veto: false,
            chancellor_veto: false,
            investigated: HashMap::new(),
        }
    }

    /// Add a player during the lobby phase.
    /// Returns true if the player was successfully added.
    pub fn add_player(&mut self, player_id: Uuid, player_connection: PlayerConnection) -> bool {
        if !matches!(self.turn_phase, TurnPhase::Lobby) {
            return false
        }
        self.conn.insert(player_id, player_connection);
        self.players.insert(player_id, PlayerState { role: PlayerType::Liberal, vote: None, dead: false });
        if self.host == None {
            self.host = Some(player_id);
        }
        true
    }

    pub fn get_player_secret(&self, player_id: &Uuid) -> Option<Uuid> {
        match self.conn.get(player_id) {
            Some(conn) => conn.secret,
            None => None
        }
    }

    pub fn has_connected_players(&self) -> bool {
        if matches!(self.turn_phase, TurnPhase::Lobby) {
            return !self.players.is_empty();
        }
        self.conn.iter().any(|(_, c)| c.connected)
    }

    /// Remove a player during the lobby phase and return true.
    /// If the game has started, mark the connection as disconnected instead and return false.
    pub fn remove_player(&mut self, player: Uuid) -> bool {
        if matches!(self.turn_phase, TurnPhase::Lobby) {
            self.players.remove(&player);
            if self.host == Some(player) {
                self.host = match self.players.keys().next() {
                    Some(uuid) => Some(*uuid),
                    None => None
                };
            }
            return true
        }
        else if let Some(conn) = self.conn.get_mut(&player) {
            conn.connected = false;
        }
        false
    }
   
    pub fn start(&mut self, player: Uuid) -> Result<(), &'static str> {
        if !matches!(self.turn_phase, TurnPhase::Lobby) {
            return Err("The game has already started!");
        }

        if self.host != Some(player) {
            return Err("Only the host may start the game!");
        }

        if self.players.len() < 5 || self.players.len() > 10 {
            return Err("There are too many or too few players to start a game!");
        }

        let mut turn_order = vec![];

        // assign roles to all players
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
        
        for ((uuid, value), role) in self.players.iter_mut().zip(roles) {
            turn_order.push(*uuid);
            value.role = role;
        }
        
        // create turn order
        turn_order.shuffle(&mut rng);
        self.president = Some(turn_order[0]);
        self.turn_order = turn_order;

        self.turn_phase = TurnPhase::Electing;
        Ok(())
    }

    pub fn choose_chancellor(&mut self, player: Uuid, target_player: Uuid) -> Result<(), &'static str> {
        if !matches!(self.turn_phase, TurnPhase::Electing) {
            return Err("You cannot perform this action at this time!");
        }

        if Some(player) != self.president {
            return Err("You are not the president, so you cannot choose the chancellor!");
        }

        if player == target_player {
            return Err("You cannot choose yourself. You must choose another player as the chancellor.");
        }

        if Some(target_player) == self.last_chancellor || Some(target_player) == self.last_president {
            return Err("You cannot choose the last elected president or chancellor.");
        }

        match self.players.get(&target_player) {
            Some(plr) => {
                if plr.dead {
                    return Err("That player is dead!")
                }
            },
            None => return Err("That player does not exist!")
        }

        self.turn_phase = TurnPhase::Voting;
        self.chancellor = Some(target_player);
        self.players.values_mut().for_each(|val| val.vote = None);
        Ok(())
    }

    pub fn vote_chancellor(&mut self, player: Uuid, vote: bool) -> Result<(), &'static str> {
        if !matches!(self.turn_phase, TurnPhase::Voting) {
            return Err("You cannot perform this action at this time!")
        }

        self.players.get_mut(&player).unwrap().vote = Some(vote);

        if self.players.values().all(|plr| plr.vote.is_some()) {
            let mut num_for = 0;
            let mut num_against = 0;
            self.players.values().for_each(|val| {
                match val.vote {
                    Some(true) => num_for += 1,
                    _ => num_against += 1
                }
            });
            if num_for > num_against {
                // hitler wins if elected chancellor with 3+ policies
                if matches!(self.players.get(&self.chancellor.unwrap()).unwrap().role, PlayerType::Hitler) && self.facist_policies >= 3 {
                    self.turn_phase = TurnPhase::Ended { winner: CardColor::Facist };
                    return Ok(())
                }
                else {
                    // do card selection
                    self.turn_phase = TurnPhase::PresidentSelect;
                    self.election_tracker = 0;
                }
            }
            else {
                // do veto continue
                self.chancellor = None;
                self.election_tracker += 1;
                if self.election_tracker > 3 {
                    self.election_tracker = 0;
                    let card = self.cards.pop().unwrap();
                    self.enact_policy(card);
                }
                else {
                    self.next_president();
                }
            }
        }
        Ok(())
    }

    /// Enact the chosen policy, reshuffle the deck if necessary, and handle moving on to the next president's turn.
    /// Does not handle discarding the selected policy cards from the deck.
    fn enact_policy(&mut self, card: CardColor) -> () {
        let mut pick_president = false;

        if self.cards.len() < 3 {
            self.cards = shuffle_deck();
        }
        match card {
            CardColor::Facist => {
                self.facist_policies += 1;
                if self.facist_policies >= 6 {
                    self.turn_phase = TurnPhase::Ended { winner: CardColor::Facist };
                }
                else {
                    match (self.players.len(), self.facist_policies) {
                        (5..=6, 3) => {
                            // examine top three
                            self.turn_phase = TurnPhase::PresidentialPower { power: PresidentialPower::PolicyPeek };
                        },
                        (9..=10, 1..=2) | (7..=8, 2) => {
                            // investigate identity
                            self.turn_phase = TurnPhase::PresidentialPower { power: PresidentialPower::InvestigateLoyalty };
                        },
                        (7..=10, 3) => {
                            // president picks next candidate
                            self.turn_phase = TurnPhase::PresidentialPower { power: PresidentialPower::CallSpecialElection };
                        }
                        (_, 4..=5) => {
                            // kill a player
                            self.turn_phase = TurnPhase::PresidentialPower { power: PresidentialPower::Execution };
                        },
                        _ => {
                            pick_president = true;
                        }
                    }
                }
            }
            CardColor::Liberal => {
                self.liberal_policies += 1;
                if self.liberal_policies >= 6 {
                    self.turn_phase = TurnPhase::Ended { winner: CardColor::Liberal };
                }
                else {
                    pick_president = true;
                }
            }
        }

        if pick_president {
            self.next_president();
        }
    }

    /// Move onto the next president, keeping track of the last president and chancellor.
    fn next_president(&mut self) -> () {
        self.last_president = self.president;
        self.last_chancellor = self.chancellor;

        self.chancellor = None;
        self.turn_counter += 1;
        self.turn_phase = TurnPhase::Electing;
        self.president = Some(self.turn_order[self.turn_counter % self.turn_order.len()]);
    }

    pub fn veto(&mut self, player: Uuid) -> Result<(), &'static str> {
        if !matches!(self.turn_phase, TurnPhase::ChancellorSelect) {
            return Err("You cannot veto a policy decision at this time!");
        }

        if self.facist_policies < 5 {
            return Err("You cannot veto policies until 5 facist policies have been passed.");
        }

        if Some(player) == self.chancellor {
            self.chancellor_veto = true;
        }
        else if Some(player) == self.president {
            self.president_veto = true;
        }
        else {
            return Err("Only the president and the chancellor may participate in the veto process.");
        }

        if self.president_veto && self.chancellor_veto {
            self.election_tracker += 1;
            if self.election_tracker > 3 {
                self.election_tracker = 0;
                for _ in 0..3 {
                    self.cards.pop();
                }
                let card = self.cards.pop().unwrap_or_else(|| {
                    self.cards = shuffle_deck();
                    self.cards.pop().unwrap()
                });
                self.enact_policy(card);
            }
            else {
                self.next_president();
            }
        }

        Ok(())
    }

    pub fn pick_card(&mut self, player: Uuid, color: CardColor) -> Result<(), &'static str> {
        match self.turn_phase {
            TurnPhase::PresidentSelect => {
                if Some(player) != self.president {
                    return Err("Only the president may select policies at this time.");
                }
                if self.cards[self.cards.len()-3..self.cards.len()].iter().any(|c| matches!(c, _color)) {
                    self.discarded_card = Some(color);
                    self.president_veto = false;
                    self.chancellor_veto = false;
                    self.turn_phase = TurnPhase::ChancellorSelect;
                    Ok(())
                }
                else {
                    return Err("That policy is not a valid option.")
                }
            },
            TurnPhase::ChancellorSelect => {
                if Some(player) != self.chancellor {
                    return Err("Only the president may select policies at this time.");
                }
                let mut matching = self.cards[self.cards.len()-3..self.cards.len()].iter().filter(|c| **c == color).count();
                if self.discarded_card == Some(color) {
                    matching -= 1;
                }
                if matching > 0 {
                    for _ in 0..3 {
                        self.cards.pop();
                    }
                    self.enact_policy(color);
                    Ok(())
                }
                else {
                    Err("This policy is not available to enact.")
                }
            },
            _ => {
                Err("You cannot perform this action at this time!")
            }
        }
    }

    pub fn execute_presidential_power(&mut self, player: Uuid, target: Option<Uuid>) -> Result<(), &'static str> {
        if Some(player) != self.president {
            return Err("Only the current president may execute presidential powers.")
        }

        if let TurnPhase::PresidentialPower { power } = &self.turn_phase {
            match power {
                PresidentialPower::InvestigateLoyalty => {
                    if let Some(target) = target {
                        match self.players.get(&target) {
                            Some(_) => {
                                if target == player {
                                    return Err("You cannot investigate yourself!")
                                }

                                let mut lst = vec![];
                                if let Some(old) = self.investigated.get(&player) {
                                    lst.extend(old);
                                }
                                lst.push(target);
                                self.investigated.insert(player, lst);

                                self.next_president();
                            },
                            None => return Err("That player does not exist!")
                        }
                    }
                    else {
                        return Err("You must select a player!");
                    }
                },
                PresidentialPower::CallSpecialElection => {
                    // president can choose any other player
                    if target == Some(player) {
                        return Err("You cannot choose yourself!")
                    }
                    if let Some(target) = target {
                        match self.players.get(&target) {
                            Some(plr) => {
                                if plr.dead {
                                    return Err("That player is dead!")
                                }
                            },
                            None => return Err("That player does not exist!")
                        }
                        self.last_president = self.president;
                        self.last_chancellor = self.chancellor;
                        self.chancellor = None;
                        self.president = Some(target);
                        self.turn_phase = TurnPhase::Electing;
                    }
                    else {
                        return Err("You must select a player!");
                    }
                },
                PresidentialPower::Execution => {
                    if target == Some(player) {
                        return Err("You cannot execute yourself!")
                    }

                    if let Some(target) = target {
                        match self.players.get_mut(&target) {
                            Some(plr) => {
                                if plr.dead {
                                    return Err("That player is already dead!")
                                }
                                else {
                                    plr.dead = true;
                                    if let Some(idx) = self.turn_order.iter().position(|p| *p == target) {
                                        self.turn_order.remove(idx);
                                    }
                                    self.next_president();
                                }
                            },
                            None => return Err("That player does not exist!")
                        }
                    }
                    else {
                        return Err("You must select a player!")
                    }
                },
                PresidentialPower::PolicyPeek => {
                    self.next_president();
                },
            }
        }
        else {
            return Err("You cannot execute a presidential power at this time.")
        }

        Ok(())
    }
}