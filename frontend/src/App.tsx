import { useRef } from 'react';
import { useState, useEffect, ReactElement } from 'react';
import './App.css';

const ChatBox = ({ lines, onSubmit }: { lines: {name: string, message: string}[], onSubmit: (line: string) => void }): ReactElement => {
  const [line, setLine] = useState<string>("");

  return <div className="chat">
    <div className="lines">{lines.map((l, i) => <div key={i}><b>{l.name}</b> {l.message}</div>)}</div>
    <input type="text" value={line} onChange={e => setLine(e.target.value)} onKeyDown={e => {
      if (e.key === "Enter")
      {
        onSubmit(line);
        setLine("");
      }
    }} />
  </div>
}

const IntroPrompt = ({ nickname: initialNickname, alert, onSubmit }: { nickname?: string, alert: string | null, onSubmit: (name: string, game: string | null) => void }): ReactElement => {
  const [nickname, setNickname] = useState<string>(initialNickname ?? localStorage.getItem("nickname") ?? "");
  const [gameCode, setGameCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert !== error) {
      setError(alert);
    }
  }, [alert]);

  return <div>
    {error != null && <div className="alert">{error}</div>}
    <b>Enter your nickname below</b>
    <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} />
    <b>Existing game code</b>
    <input type="text" value={gameCode} onChange={e => setGameCode(e.target.value)} />
    <button onClick={() => onSubmit(nickname, null)}>Host Game</button>
    <button onClick={() => {
      if (nickname.trim() === "") {
        setError("You must enter a valid nickname to join the game.");
      }
      else if (gameCode.trim() === "") {
        setError("You must enter a valid game code to join the game.");
      }
      else {
        onSubmit(nickname, gameCode);
      }
    }}>Join Game</button>
  </div>;
};

function App() {
  return <>
    <Game nickname="bob" />
    <Game nickname="joe" />
    <Game nickname="john" />
    <Game nickname="jimmy" />
    <Game nickname="jack" />
  </>
}

type GameProps = {
  nickname?: string,
  gameId?: string
}

enum TurnPhase {
  INTRO = "Intro",
  LOBBY = "Lobby",
  ELECTING = "Electing",
  VOTING = "Voting",
  PRESIDENT_SELECT = "PresidentSelect",
  CHANCELLOR_SELECT = "ChancellorSelect",
  POWER = "PresidentialPower",
  ENDED = "Ended",
}

enum CardColor {
  LIBERAL = "Liberal",
  FACIST = "Facist",
}

enum PresidentialPower {
  POLICY_PEEK = "PolicyPeek",
  INVESTIGATE = "InvestigateLoyalty",
  ELECTION = "CallSpecialElection",
  EXECUTE = "Execution",
}

type Uuid = string;
type GameState = {
  [key: string]: any,
  cards?: CardColor[],
  players: { [key: string]: { name: string, vote: boolean | null, role: "Hitler" | "Facist" | "Liberal" | null, dead: boolean } },
  turn_phase: { type: TurnPhase, winner?: CardColor, power?: PresidentialPower },
  host?: Uuid,
  president?: Uuid,
  chancellor?: Uuid,
  turn_order: Uuid[],
  liberal_policies: number,
  facist_policies: number,
  votes?: number
};

const PlayerList = ({ gameState, playerId, onSelect } : { gameState: GameState, playerId: Uuid, onSelect?: (id: Uuid) => void }) => {
  const isSelectingChancellor = gameState.turn_phase.type === TurnPhase.ELECTING && gameState.president === playerId;
  const isVoting = gameState.turn_phase.type === TurnPhase.VOTING;

  return <>
    <b>Players</b>
    <ul>
      {gameState.turn_order.length <= 0 ? Object.entries(gameState.players).map(([id, data]) => <li key={id}>{data.name} {id === gameState.host && " (Host)"}</li>) : gameState.turn_order.map(id => {
        const playerData = gameState.players[id];
        return <li key={id}>
          {playerData.name}
          {gameState.president === id && <span className="role">{' '}(President)</span>}
          {gameState.chancellor === id && <span className="role">{' '}(Chancellor{isVoting && " Elect"})</span>}
          {playerData.role != null && <span className="affiliation">{' '}({playerData.role})</span>}
          {playerData.dead && <span>{' '}Dead</span>}
          {isSelectingChancellor && id !== playerId && <button onClick={(e) => {
            e.preventDefault();
            onSelect && onSelect(id);
          }}>Nominate as Chancellor</button>}
          {playerData.vote != null && <span className="vote">{' '}({ gameState.players[id].vote ? "Aye": "Nay" })</span>}
          {gameState.turn_phase.type === TurnPhase.POWER && gameState.turn_phase.power !== PresidentialPower.POLICY_PEEK && <button onClick={(e) => {
            e.preventDefault();
            onSelect && onSelect(id);
          }}>{gameState.turn_phase.power}</button>}
        </li>;
      })}
    </ul>
  </>
}

const PlayerVote = ({ onSelect, remaining }: { onSelect: (vote: boolean) => void, remaining: number }) => {
  return <>
    <button onClick={(e) => {
      e.preventDefault();
      onSelect(true);
    }}>Yes</button>
    <button onClick={(e) => {
      e.preventDefault();
      onSelect(false);
    }}>No</button>
    <span>{' '}{remaining} voters remaining</span>
  </>
}

const CardSelect = ({ cards, onSelect } : { cards?: CardColor[], onSelect: (card: CardColor) => void }) => {
  if (cards == null) {
    return <div />
  }
  return <div>
    {cards.map((card, i) => <button key={i} onClick={(e) => {
      e.preventDefault();
      onSelect(card);
    }}>{card}</button>)}
  </div>
}

const CardTable = ({ gameState } : { gameState: GameState }) => {
  return <>
    <div className="facist policyTable">
      {[...Array(6).keys()].map(idx => {
        return <div key={idx} className={`facist policySlot ${gameState.facist_policies > idx ? "active" : "inactive"}`}>
          <img src="/images/facist.png" alt="facist card" />
        </div>
      })}
    </div>
    <div className="liberal policyTable">
      {[...Array(5).keys()].map(idx => {
        return <div key={idx} className={`liberal policySlot ${gameState.liberal_policies > idx ? "active" : "inactive"}`}>
          <img src="/images/liberal.png" alt="liberal card" />
        </div>
      })}
    </div>
  </>;
};

const PolicyPeek = ({ cards, onConfirm }: { cards: CardColor[], onConfirm: () => void }) => {
  return <>
    <h3>Peek at the next 3 cards</h3>
    <div>
      {cards.map((card, idx) => <div key={idx} className={`${card.toLowerCase()} policySlot active`}><img src={`/images/${card.toLowerCase()}.png`} /></div>)}
    </div>
    <button onClick={(e) => {
      e.preventDefault();
      onConfirm();
    }}>Confirm</button>
  </>
};

function Game({ nickname, gameId: initialGameId }: GameProps) {
  const [alert, setAlert] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>({ players: {}, turn_phase: { type: TurnPhase.INTRO }, turn_order: [], liberal_policies: 0, facist_policies: 0 });
  const [chatLines, setChatLines] = useState<{ name: string, message: string }[]>([]);
  
  const [playerId, setPlayerId] = useState<Uuid | null>(localStorage.getItem("playerId"));
  const [playerSecret, setPlayerSecret] = useState<Uuid | null>(localStorage.getItem("playerSecret"));
  
  const [gameId, setGameId] = useState<Uuid | null>(initialGameId ?? localStorage.getItem("gameId"));
  const [connected, setConnected] = useState<boolean>(false);
  
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (playerId != null) {
      localStorage.setItem("playerId", playerId);
    }
  }, [playerId]);
  
  useEffect(() => {
    if (gameId != null) {
      localStorage.setItem("gameId", gameId);
    }
  }, [gameId]);

  useEffect(() => {
    if (playerSecret != null) {
      localStorage.setItem("playerSecret", playerSecret);
    }
  }, [playerSecret]);
  
  const connect = () => {
    ws.current = new WebSocket("ws://localhost:8000/ws/");
    ws.current.onopen = () => {
      setConnected(true);
      const finalPlayerId = playerId ?? localStorage.getItem("playerId");
      const nickname = localStorage.getItem("nickname");
      const finalPlayerSecret = playerSecret ?? localStorage.getItem("playerSecret");
      if (finalPlayerId != null && nickname != null && finalPlayerSecret != null) {
        ws.current?.send(JSON.stringify({type: "JoinGame", "nickname": nickname, "id": gameId, "player_id": finalPlayerId, "player_secret": finalPlayerSecret}));
      }
    };
    ws.current.onclose = () => {
      setConnected(false);
    };
    ws.current.onmessage = (msg) => {
      const packet = JSON.parse(msg.data);
      switch (packet.type) {
        case "Alert":
          setAlert(packet.message);
          break;
        case "SetIdentifiers":
          setGameId(packet.game_id);
          setPlayerId(packet.player_id);
          setPlayerSecret(packet.player_secret);
          break;
        case "ReceiveChat":
          setChatLines(l => [...l, packet]);
          break;
        case "GameState":
          console.log(packet.state);
          setGameState(packet.state);
          break;
      }
    };
  }

  useEffect(connect, []);

  if (gameState.turn_phase.type === TurnPhase.INTRO || playerId == null) {
    return <div className="content">
      <div className="welcome">
        <h1>Secret Hitler</h1>
        <IntroPrompt nickname={nickname} alert={alert} onSubmit={(nick, game) => {
          localStorage.setItem("nickname", nick);
          ws.current?.send(JSON.stringify({ "type": game != null ? "JoinGame" : "HostGame", "nickname": nick, "id": game }));
        }} />
      </div>
    </div>;
  }

  return <div className="content">
    <div className="game">
      {alert != null && <div className="alert">{alert}</div>}
      {gameState.turn_phase.type === TurnPhase.LOBBY ? <div>
        <b>Join Code: </b> {gameId}<br />
        <PlayerList gameState={gameState} playerId={playerId} />
        <button disabled={playerId !== gameState.host} onClick={() => ws.current?.send(JSON.stringify({ type: "StartGame" }))}>Start Game</button>
      </div> : <div>
        <PlayerList gameState={gameState} playerId={playerId} onSelect={(id) => {
          if (gameState.turn_phase.type === TurnPhase.ELECTING) {
            ws.current?.send(JSON.stringify({ "type": "ChooseChancellor", "player": id }));
          }
          if (gameState.turn_phase.type === TurnPhase.POWER) {
            ws.current?.send(JSON.stringify({ "type": "PresidentialPower", "player": id }));
          }
        }} />
        <CardTable gameState={gameState} />
        {gameState.turn_phase.type === TurnPhase.VOTING && <PlayerVote remaining={gameState.turn_order.length - (gameState.votes ?? 0)} onSelect={(vote) => {
          ws.current?.send(JSON.stringify({ "type": "VoteChancellor", vote: vote }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.PRESIDENT_SELECT && gameState.president === playerId && <CardSelect cards={gameState.cards} onSelect={(card) => {
          ws.current?.send(JSON.stringify({ "type": "PickCard", color: card === CardColor.FACIST }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.CHANCELLOR_SELECT && gameState.chancellor === playerId && <CardSelect cards={gameState.cards} onSelect={(card) => {
          ws.current?.send(JSON.stringify({ "type": "PickCard", color: card === CardColor.FACIST }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.POWER && gameState.turn_phase.power === PresidentialPower.POLICY_PEEK && <PolicyPeek cards={gameState.cards ?? []} onConfirm={() => {
          ws.current?.send(JSON.stringify({ "type": "PresidentialPower" }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.ENDED && <h1>Game Over! {gameState.turn_phase.winner}s win!</h1>}
      </div>}
    </div>
    <ChatBox lines={chatLines} onSubmit={(line) => ws.current?.send(JSON.stringify({type: "SendChat", message: line}))} />
  </div>;
}

export default App;
