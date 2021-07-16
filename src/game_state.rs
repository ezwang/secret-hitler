use uuid::Uuid;
use rand::{Rng, seq::SliceRandom, thread_rng};
use std::{collections::HashMap, time::SystemTime};

use crate::protocol;
use protocol::PlayerType;

struct PlayerState {
    role: PlayerType,
    vote: Option<bool>,
}

enum TurnPhase {
    Lobby,
    Ended { winner: CardColor },
    
    Electing,
    Voting,
    PresidentSelect,
    ChancellorSelect,

    InvestigateLoyalty,
    CallSpecialElection,
    PolicyPeek,
    Execution,
    VetoPower,
}

enum CardColor {
    Facist,
    Liberal
}

pub struct GameState {
    creation: SystemTime,
    timeout: Option<SystemTime>,
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
    host: Option<Uuid>
}

enum GameEvent {
    AlertInvalid { player: Uuid, msg: String },
    SetRole { player: Uuid, role: PlayerType },
    SetHost { player: Uuid },
    AddPlayer { player: Uuid },
    RemovePlayer { player: Uuid },
    StartGame,
    PresidentPick { player: Uuid },
    VoteChancellor { player: Uuid },
    SetVoted { player: Uuid },
    SetEnded { winner: CardColor },
}

fn shuffle_deck() -> Vec<CardColor> {
    let cards = vec![];
    for _ in 0..6 {
        cards.push(CardColor::Liberal);
    }
    for _ in 0..11 {
        cards.push(CardColor::Facist);
    }
    cards.shuffle(&mut thread_rng());
    cards
}


impl GameState {
    fn send_event(self, event: GameEvent) -> () {
        // TODO: process game events
    }

    pub fn new() -> GameState {

        GameState {
            creation: SystemTime::now(),
            timeout: Option::None,
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
        }
    }

    pub fn add_player(&mut self, player: Uuid) -> bool {
        if !matches!(self.turn_phase, TurnPhase::Lobby) {
            return false
        }
        self.players.insert(player, PlayerState { role: PlayerType::Liberal, vote: None });
        if self.host == None {
            self.host = Some(player);
            self.send_event(GameEvent::SetHost { player });
        }
        true
    }

    pub fn remove_player(&mut self, player: Uuid) -> bool {
        if matches!(self.turn_phase, TurnPhase::Lobby) {
            self.players.remove(&player);
            if self.host == Some(player) {
                self.host = match self.players.keys().next() {
                    Some(uuid) => Some(*uuid),
                    None => None
                };
                if let Some(host) = self.host {
                    self.send_event(GameEvent::SetHost { player: host });
                }
            }
            return true
        }
        false
    }
    
    pub fn start(&mut self, player: Uuid) -> () {
        if !matches!(self.turn_phase, TurnPhase::Lobby) {
            self.send_event(GameEvent::AlertInvalid { player, msg: "The game has already started!".into() });
            return
        }

        if self.host != Some(player) {
            self.send_event(GameEvent::AlertInvalid { player, msg: "Only the host may start the game!".into() });
            return
        }

        if self.players.len() < 5 || self.players.len() > 10 {
            self.send_event(GameEvent::AlertInvalid { player, msg: "There are too many or too few players to start a game!".into() });
            return
        }

        let turn_order = vec![];

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

        // pass information to players
        for (player, value) in self.players.iter() {
            self.send_event(GameEvent::SetRole { player: *player, role: value.role });
        }
        self.turn_phase = TurnPhase::Electing;
        self.send_event(GameEvent::StartGame);
        self.send_event(GameEvent::PresidentPick { player: self.president.unwrap() });
    }

    pub fn choose_chancellor(&mut self, player: Uuid, target_player: Uuid) -> () {
        if !matches!(self.turn_phase, TurnPhase::ChancellorSelect) {
            self.send_event(GameEvent::AlertInvalid { player, msg: "You cannot perform this action at this time!".into() });
            return
        }

        if Some(player) != self.president {
            self.send_event(GameEvent::AlertInvalid { player, msg: "You are not the president, so you cannot choose the chancellor!".into() });
            return
        }

        if player == target_player {
            self.send_event(GameEvent::AlertInvalid { player, msg: "You cannot choose yourself. You must choose another player as the chancellor.".into() });
            return
        }

        if Some(target_player) == self.last_chancellor || Some(target_player) == self.last_president {
            self.send_event(GameEvent::AlertInvalid { player, msg: "You cannot choose the last elected president or chancellor.".into() });
            return
        }

        if matches!(self.players.get(&target_player).unwrap().role, PlayerType::Hitler) && self.facist_policies >= 3 {
            self.turn_phase = TurnPhase::Ended { winner: CardColor::Facist };
            self.send_event(GameEvent::SetEnded { winner: CardColor::Facist });
            return
        }

        self.turn_phase = TurnPhase::Electing;
        self.chancellor = Some(target_player);
        self.send_event(GameEvent::VoteChancellor { player: target_player });
        self.players.values_mut().for_each(|val| val.vote = None);
    }

    pub fn vote_chancellor(&mut self, player: Uuid, vote: bool) -> () {
        if !matches!(self.turn_phase, TurnPhase::Electing) {
            self.send_event(GameEvent::AlertInvalid { player, msg: "You cannot perform this action at this time!".into() });
            return
        }

        self.players.get_mut(&player).unwrap().vote = Some(vote);
        self.send_event(GameEvent::SetVoted { player });

        if self.players.values().all(|plr| plr.vote.is_some()) {
            let num_for = 0;
            let num_against = 0;
            self.players.values().for_each(|val| {
                match val.vote {
                    Some(true) => num_for += 1,
                    _ => num_against += 1
                }
            });
            if num_for > num_against {
                // do card selection
                self.turn_phase = TurnPhase::PresidentSelect;
                self.election_tracker = 0;
            }
            else {
                // do veto continue
                self.chancellor = None;
                self.turn_counter += 1;
                self.election_tracker += 1;
                if self.election_tracker > 3 {
                    self.election_tracker = 0;
                    self.enact_policy(self.cards.pop().unwrap());
                }
                else {
                    self.last_president = self.president;
                    self.president = Some(self.turn_order[self.turn_counter % self.turn_order.len()]);
                    self.send_event(GameEvent::PresidentPick { player: self.president.unwrap() });
                }
            }
        }
    }

    /// Enact the chosen policy, reshuffle the deck if necessary, and handle moving on to the next president's turn.
    /// Does not handle discarding the selected policy cards from the deck.
    fn enact_policy(&mut self, card: CardColor) -> () {
        self.last_president = self.president;
        self.last_chancellor = self.chancellor;

        let ended = false;

        if self.cards.len() < 3 {
            self.cards = shuffle_deck();
        }
        match card {
            CardColor::Facist => {
                self.facist_policies += 1;
                if self.facist_policies >= 6 {
                    self.turn_phase = TurnPhase::Ended { winner: CardColor::Facist };
                    self.send_event(GameEvent::SetEnded { winner: CardColor::Facist });
                    ended = true;
                }
            }
            CardColor::Liberal => {
                self.liberal_policies += 1;
                if self.liberal_policies >= 6 {
                    self.turn_phase = TurnPhase::Ended { winner: CardColor::Liberal };
                    self.send_event(GameEvent::SetEnded { winner: CardColor::Liberal });
                    ended = true;
                }
            }
        }

        if !ended {
            self.chancellor = None;
            self.turn_counter += 1;
            self.president = Some(self.turn_order[self.turn_counter % self.turn_order.len()]);
            self.send_event(GameEvent::PresidentPick { player: self.president.unwrap() });
        }
    }

    pub fn pick_card(&mut self, player: Uuid, color: CardColor) {
        match self.turn_phase {
            TurnPhase::PresidentSelect => {
                if Some(player) != self.president {
                    self.send_event(GameEvent::AlertInvalid { player, msg: "Only the president may select policies at this time.".into() });
                    return
                }
                if self.cards[self.cards.len()-3..self.cards.len()].iter().any(|c| matches!(c, color)) {
                    self.discarded_card = Some(color);
                    self.turn_phase = TurnPhase::ChancellorSelect;
                }
                else {
                    self.send_event(GameEvent::AlertInvalid { player, msg: "That policy is not a valid option.".into() });
                    return
                }
            },
            TurnPhase::ChancellorSelect => {
                if Some(player) != self.chancellor {
                    self.send_event(GameEvent::AlertInvalid { player, msg: "Only the president may select policies at this time.".into() });
                    return
                }
                let matching = self.cards[self.cards.len()-3..self.cards.len()].iter().filter(|c| matches!(c, color)).count();
                if matches!(self.discarded_card, color) {
                    matching -= 1;
                }
                if matching > 0 {
                    for _ in 0..3 {
                        self.cards.pop();
                    }
                    self.enact_policy(color);
                }
                else {
                    self.send_event(GameEvent::AlertInvalid { player, msg: "This policy is not available to enact.".into() });
                }
            },
            _ => {
                self.send_event(GameEvent::AlertInvalid { player, msg: "You cannot perform this action at this time!".into() });
            }
        }
    }
}