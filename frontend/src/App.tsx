import { useRef } from 'react';
import { useState, useEffect, ReactElement } from 'react';
import './App.css';

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

type ChatLine = { id?: Uuid, message: string };

const ChatBox = ({ gameState, lines, onSubmit, playerId }: { playerId: Uuid, gameState: GameState, lines: ChatLine[], onSubmit: (line: string) => void }): ReactElement => {
  const [line, setLine] = useState<string>("");
  const chatOutput = useRef<HTMLDivElement>(null);

  const showDead = gameState.turn_phase.type === TurnPhase.ENDED || gameState.players[playerId].dead;

  useEffect(() => {
    if (chatOutput.current != null) {
      chatOutput.current.scrollTop = chatOutput.current.scrollHeight;
    }
  }, [lines]);

  return <div className="chat">
    <div ref={chatOutput} className="lines">{lines.map((l, i) => {
      if (l.id != null) {
        if (!showDead && gameState.players[l.id].dead) {
          return null
        }
        return <div key={i}><b>{gameState.players[l.id].name}</b> {l.message}</div>
      }
      else {
        return <div key={i} className="system">{l.message}</div>
      }
    })}</div>
    <input placeholder="Press enter to send" type="text" value={line} onChange={e => setLine(e.target.value)} onKeyDown={e => {
      if (e.key === "Enter" && line.trim().length > 0)
      {
        onSubmit(line);
        setLine("");
      }
    }} />
  </div>
}

const IntroPrompt = ({ nickname: initialNickname, suffix, alert, onSubmit }: { nickname?: string, suffix: string, alert: string | null, onSubmit: (name: string, game: string | null) => void }): ReactElement => {
  const [nickname, setNickname] = useState<string>(initialNickname ?? localStorage.getItem(`nickname${suffix}`) ?? "");
  const [gameCode, setGameCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert !== error) {
      setError(alert);
    }
  }, [alert]);

  const joinGame = () => {
    if (nickname.trim() === "") {
      setError("You must enter a valid nickname to join the game.");
    }
    else if (gameCode.trim() === "") {
      setError("You must enter a valid game code to join the game.");
    }
    else {
      onSubmit(nickname, gameCode);
    }
  };

  return <div>
    {error != null && <p className="alert">{error}</p>}
    <b>Enter your nickname below</b>
    <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} />
    <b>Existing game code</b>
    <input type="text" value={gameCode} onChange={e => setGameCode(e.target.value)} onKeyDown={(e) => {
      if (e.key === "Enter") {
        joinGame();
      }
    }} />
    <div className="mb-3">
      <button className="btn" onClick={() => onSubmit(nickname, null)}>Host Game</button>
      <button className="btn" onClick={joinGame}>Join Game</button>
    </div>
    <p>Based on <a href="https://www.secrethitler.com/" target="_blank" rel="noopener noreferrer">the board game</a> - CC SA–BY–NC 4.0</p>
  </div>;
};

function App() {
  return <Game /> 
}

type GameProps = {
  nickname?: string,
  gameId?: string,
  suffix?: string,
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

const Lobby = ({ gameState, playerId, gameId, onStart, onReset }: { gameState: GameState, playerId: Uuid, gameId: Uuid, onStart: () => void, onReset: () => void }) => {
  const numPlayers = Object.keys(gameState.players).length;
  const isHost = playerId === gameState.host;

  return <>
    <h1>Secret Hitler Lobby</h1>
    <p className="loading">Waiting for players</p>
    <p><b>Join Code: </b> {gameId}</p>
    <div className="mb-3">
      <PlayerList gameState={gameState} playerId={playerId} />
    </div>

    {!isHost && <p>Only the host may start the game.</p>}
    {numPlayers < 5 && <p>You need at least 5 players to start the game.</p>}
    {numPlayers > 10 && <p>There can be at most 10 players in a game.</p>}
    <button className="btn" disabled={numPlayers < 5 || numPlayers > 10 || !isHost} onClick={onStart}>Start Game</button>
    <button className="btn" onClick={onReset}>Exit Lobby</button>
  </>
}

const PlayerList = ({ gameState, playerId, onSelect } : { gameState: GameState, playerId: Uuid, onSelect?: (id: Uuid) => void }) => {
  // lobby player list
  if (gameState.turn_order.length <= 0) {
    const numPlayers = Object.keys(gameState.players).length;
    return <>
      <b>Players <span style={{ color: numPlayers >= 5 && numPlayers <= 10 ? "green" : "red" }}>({numPlayers}/10)</span></b>
      <ul className="playerList">
        {Object.entries(gameState.players).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, data]) => <li key={id} className={playerId === id ? "self" : "other"}>{data.name} {id === gameState.host && " (Host)"}</li>)}
      </ul>
    </>;
  }

  const isSelectingChancellor = gameState.turn_phase.type === TurnPhase.ELECTING && gameState.president === playerId;
  const isVoting = gameState.turn_phase.type === TurnPhase.VOTING;

  return <>
    <b>Players</b>
    <ul className="playerList">
      {gameState.turn_order.map(id => {
        const playerData = gameState.players[id];
        return <li key={id} className={playerId === id ? "self" : "other"}>
          {playerData.name}
          {gameState.president === id && <span className="role">{' '}(President)</span>}
          {gameState.chancellor === id && <span className="role">{' '}(Chancellor{isVoting && " Elect"})</span>}
          {playerData.role != null && <span className={`affiliation ${playerData.role.toLowerCase()}`}>{' '}({playerData.role})</span>}
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

const PlayerVote = ({ gameState, onSelect, playerId }: { gameState: GameState, onSelect: (vote: boolean) => void, playerId: Uuid }) => {
  const remaining = gameState.turn_order.length - (gameState.votes ?? 0);
  const playerVote = gameState.players[playerId].vote;

  return <div className="voteBox">
    {gameState.chancellor != null && <div>Voting to elect <b>{gameState.players[gameState.chancellor].name}</b> as chancellor</div>}
    <p className="voteStatus"><b>{remaining}</b> voters remaining</p>
    <button className={playerVote === true ? "active" : undefined} onClick={(e) => {
      e.preventDefault();
      onSelect(true);
    }}>Ja!<span className="helpText">(Yes)</span></button>
    <button className={playerVote === false ? "active" : undefined} onClick={(e) => {
      e.preventDefault();
      onSelect(false);
    }}>Nien<span className="helpText">(No)</span></button>
  </div>
}

const CardSelect = ({ cards, onSelect } : { cards?: CardColor[], onSelect: (card: CardColor) => void }) => {
  if (cards == null) {
    return <div />
  }
  return <div className="cardSelectBox">
    <p>{cards.length === 3 ? <>Choose the policy you would like to <b>discard</b></> : <>Choose the policy you would like to <b>enact</b></>}</p>
    {cards.map((card, i) => <button className={`policySlot ${card.toLowerCase()} active`} key={i} onClick={(e) => {
      e.preventDefault();
      onSelect(card);
    }}><img src={`/images/${card.toLowerCase()}.png`} alt={`${card} card`} /></button>)}
  </div>
}

const CardTable = ({ gameState } : { gameState: GameState }) => {
  let numPlayers = Object.keys(gameState.players).length;
  let powers = [null, null, null, PresidentialPower.EXECUTE, PresidentialPower.EXECUTE, null];

  if (numPlayers >= 9) {
    powers[0] = PresidentialPower.INVESTIGATE;
  }
  if (numPlayers >= 7) {
    powers[1] = PresidentialPower.INVESTIGATE;
    powers[2] = PresidentialPower.ELECTION;
  }
  else {
    powers[2] = PresidentialPower.POLICY_PEEK;
  }

  return <>
    <div className="facist policyTable">
      {[...Array(6).keys()].map(idx => {
        return <div key={idx} className={`facist policySlot ${gameState.facist_policies > idx ? "active" : "inactive"}`}>
          <img src="/images/facist.png" alt="facist card" />
          {powers[idx] != null && <div>{powers[idx]}</div>}
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
      {cards.map((card, idx) => <div key={idx} className={`${card.toLowerCase()} policySlot active`}><img src={`/images/${card.toLowerCase()}.png`} alt={`${card.toLowerCase()} card`} /></div>)}
    </div>
    <button onClick={(e) => {
      e.preventDefault();
      onConfirm();
    }}>Confirm</button>
  </>
};

function Game({ nickname, gameId: initialGameId, suffix = "" }: GameProps) {
  const [alert, setAlert] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>({ players: {}, turn_phase: { type: TurnPhase.INTRO }, turn_order: [], liberal_policies: 0, facist_policies: 0 });
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  
  const [playerId, setPlayerId] = useState<Uuid | null>(localStorage.getItem(`playerId${suffix}`));
  const [playerSecret, setPlayerSecret] = useState<Uuid | null>(localStorage.getItem(`playerSecret${suffix}`));
  
  const [gameId, setGameId] = useState<Uuid | null>(initialGameId ?? localStorage.getItem("gameId"));
  const [connected, setConnected] = useState<boolean>(false);
  
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (playerId != null) {
      localStorage.setItem(`playerId${suffix}`, playerId);
    }
  }, [playerId]);
  
  useEffect(() => {
    if (gameId != null) {
      localStorage.setItem("gameId", gameId);
    }
  }, [gameId]);

  useEffect(() => {
    if (playerSecret != null) {
      localStorage.setItem(`playerSecret${suffix}`, playerSecret);
    }
  }, [playerSecret]);

  useEffect(() => {
    // don't attempt to reconnect to an ended game on page load
    if (gameState.turn_phase.type === TurnPhase.ENDED) {
      localStorage.removeItem(`playerId${suffix}`);
      localStorage.removeItem("gameId");
    }
  }, [gameState]);
  
  const connect = () => {
    ws.current = new WebSocket(`${window.location.protocol.replace('http', 'ws')}//${window.location.host}/ws/`);
    ws.current.onopen = () => {
      setConnected(true);
      const finalPlayerId = playerId ?? localStorage.getItem(`playerId${suffix}`);
      const nickname = localStorage.getItem(`nickname${suffix}`);
      const finalPlayerSecret = playerSecret ?? localStorage.getItem(`playerSecret${suffix}`);
      if (finalPlayerId != null && nickname != null && finalPlayerSecret != null) {
        ws.current?.send(JSON.stringify({type: "JoinGame", "nickname": nickname, "id": gameId, "player_id": finalPlayerId, "player_secret": finalPlayerSecret}));
        ws.current?.send(JSON.stringify({ type: "GetChatLog" }));
      }
    };
    ws.current.onclose = () => {
      setConnected(false);
      setTimeout(connect, 100);
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
          setPlayerSecret(packet.secret);
          break;
        case "ReceiveChat":
          setChatLines(l => [...l, packet]);
          break;
        case "ChatLog":
          setChatLines(packet.log);
          break;
        case "GameState":
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
        <p>A social deduction game for 5-10 people</p>
        <IntroPrompt suffix={suffix} nickname={nickname} alert={alert} onSubmit={(nick, game) => {
          setAlert(null);
          localStorage.setItem(`nickname${suffix}`, nick);
          ws.current?.send(JSON.stringify({ "type": game != null ? "JoinGame" : "HostGame", "nickname": nick, "id": game }));
        }} />
      </div>
    </div>;
  }

  return <div className="content">
    <div className="game">
      {alert != null && <div className="alert">{alert}</div>}
      {gameState.turn_phase.type === TurnPhase.LOBBY ?
        <Lobby
          gameState={gameState}
          playerId={playerId}
          gameId={gameId ?? ""}
          onStart={() => ws.current?.send(JSON.stringify({ type: "StartGame" }))}
          onReset={() => {
            ws.current?.send(JSON.stringify({ type: "Leave" }));
            setPlayerId(null);
            setGameId(null);
            setChatLines([]);
            setAlert(null);
            localStorage.removeItem("gameId");
            localStorage.removeItem(`playerId${suffix}`);
            localStorage.removeItem(`playerSecret${suffix}`);
            setGameState((state) => ({...state, turn_phase: { type: TurnPhase.INTRO }}));
          }} /> : <div>
        <PlayerList gameState={gameState} playerId={playerId} onSelect={(id) => {
          if (gameState.turn_phase.type === TurnPhase.ELECTING) {
            ws.current?.send(JSON.stringify({ "type": "ChooseChancellor", "player": id }));
          }
          if (gameState.turn_phase.type === TurnPhase.POWER) {
            ws.current?.send(JSON.stringify({ "type": "PresidentialPower", "player": id }));
          }
        }} />
        <CardTable gameState={gameState} />
        {gameState.turn_phase.type === TurnPhase.VOTING && <PlayerVote gameState={gameState} playerId={playerId} onSelect={(vote) => {
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
    <ChatBox playerId={playerId} gameState={gameState} lines={chatLines} onSubmit={(line) => ws.current?.send(JSON.stringify({type: "SendChat", message: line}))} />
    {!connected && <div className="disconnected">Disconnected</div>}
  </div>;
}

export default App;
