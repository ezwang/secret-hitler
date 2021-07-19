import { useRef } from 'react';
import { useState, useEffect, ReactElement } from 'react';
import Draggable from 'react-draggable';
import confetti from 'canvas-confetti';
import './App.css';

import reactStringReplace from 'react-string-replace';

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

  const showDead = gameState.turn_phase.type === TurnPhase.ENDED || gameState.players[playerId]?.dead;

  useEffect(() => {
    if (chatOutput.current != null) {
      chatOutput.current.scrollTop = chatOutput.current.scrollHeight;
    }
  }, [lines]);

  return <div className="chat">
    <div ref={chatOutput} className="lines">{lines.map((l, i) => {
      if (l.id != null) {
        if (!showDead && gameState.players[l.id]?.dead) {
          return null
        }
        return <div key={i} className="line"><b>{gameState.players[l.id]?.name ?? "Unknown"}</b> {l.message}</div>
      }
      else {
        return <div key={i} className="system">{reactStringReplace(l.message, /\s(liberals?|facists?)/ig, (match) => <>{' '}<span style={{ fontWeight: "bold", color: match.toLowerCase().startsWith("facist") ? "red" : "blue" }}>{match}</span>{' '}</>)}</div>
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

const IntroPrompt = ({ nickname: initialNickname, suffix, alert, onSubmit, gameId, clickedLink }: { clickedLink: boolean, nickname?: string, suffix: string, gameId?: Uuid | null, alert: string | null, onSubmit: (name: string, game: string | null) => void }): ReactElement => {
  const [nickname, setNickname] = useState<string>(initialNickname ?? localStorage.getItem(`nickname${suffix}`) ?? "");
  const [gameCode, setGameCode] = useState<string>(gameId ?? "");
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
      <button disabled={gameCode.length >= 36 && clickedLink} className="btn" onClick={() => onSubmit(nickname, null)}>Host Game</button>
      <button className="btn" onClick={joinGame}>Join Game</button>
    </div>
    <p>Based on <a href="https://www.secrethitler.com/" target="_blank" rel="noopener noreferrer">the board game</a> - CC SA–BY–NC 4.0</p>
    <p>Find the source code <a href="https://github.com/ezwang/secret-hitler" target="_blank" rel="noopener noreferrer">here</a></p>
  </div>;
};

function App() {
  if (window.location.hostname === "localhost") {
    return <>
      <Game nickname="jack" suffix="0" />
      <Game nickname="jacob" suffix="1" />
      <Game nickname="jake" suffix="2" />
      <Game nickname="james" suffix="3" />
      <Game nickname="jill" suffix="4" />
      <Game nickname="joe" suffix="5" />
      <Game nickname="john" suffix="6" />
      <Game nickname="joshua" suffix="7" />
      <Game nickname="julia" suffix="8" />
    </>
  }
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
  cards?: CardColor[],
  cards_in_deck?: number,
  cards_in_discard?: number,
  chancellor?: Uuid,
  election_tracker?: number,
  facist_policies: number,
  host?: Uuid,
  last_chancellor?: Uuid,
  last_president?: Uuid,
  liberal_policies: number,
  num_facists?: number,
  players: { [key: string]: { name: string, vote: boolean | null, role: "Hitler" | "Facist" | "Liberal" | null, dead: boolean } },
  president?: Uuid,
  turn_order: Uuid[],
  turn_phase: { type: TurnPhase, winner?: CardColor, power?: PresidentialPower },
  votes?: number,
};

const ElectionTracker = ({ num = 0 }: { num?: number }) => {
  return <div className="electionTracker">
    {[...Array(3).keys()].map(idx => <div key={idx} className={`electionDot ${num > idx && "active"}`} />)}
  </div>
}

const CopyToClipboard = ({ url }: { url: string }) => {
  return <a href={url} onClick={(e) => {
    e.preventDefault();
    navigator.clipboard.writeText(url);
  }}>{url}</a>
};

const Lobby = ({ gameState, playerId, gameId, onStart, onReset }: { gameState: GameState, playerId: Uuid, gameId: Uuid, onStart: () => void, onReset: () => void }) => {
  const numPlayers = Object.keys(gameState.players).length;
  const isHost = playerId === gameState.host;
  const url = `${window.location.origin}/game/${gameId}`

  return <>
    <h1>Secret Hitler Lobby</h1>
    <p className="flavor">The year is 1932. The place is pre-WWII Germany. In Secret Hitler, players are German politicians attempting to hold a fragile Liberal government together and stem the rising tide of Fascism. Watch out though - there are secret Fascists among you, and one player is Secret Hitler.</p>
    <p className="loading">Waiting for players</p>
    <p><b>Join Code: </b> {gameId}</p>
    <p><b>Link: </b> <CopyToClipboard url={url} /> (Click to Copy)</p>
    <div className="mb-3">
      <PlayerList gameState={gameState} playerId={playerId} />
    </div>

    <p>New to the game? Check out the rules <a href="https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf" target="_blank" rel="noopener noreferrer">here</a>.</p>
    {!isHost && <p>Only the host may start the game.</p>}
    {numPlayers < 5 && <p>You need at least 5 players to start the game.</p>}
    {numPlayers > 10 && <p>There can be at most 10 players in a game.</p>}
    <button className="btn" disabled={numPlayers < 5 || numPlayers > 10 || !isHost} onClick={onStart}>Start Game</button>
    <button className="btn" onClick={onReset}>Exit Lobby</button>
  </>
}

function getPowerDisplayName(power?: PresidentialPower): string  {
  switch (power) {
    case PresidentialPower.ELECTION:
      return "Elect as President";
    case PresidentialPower.INVESTIGATE:
      return "Investigate Affiliation";
    case PresidentialPower.EXECUTE:
      return "Kill";
    case PresidentialPower.POLICY_PEEK:
      return "Peek Policies";
    default:
      return "Unknown";
  }
}

function getPowerDescription(power?: PresidentialPower | null): string  {
  switch (power) {
    case PresidentialPower.ELECTION:
      return "The president pick the next presidential candidate.";
    case PresidentialPower.INVESTIGATE:
      return "The president investigates a player's identity card.";
    case PresidentialPower.EXECUTE:
      return "The president must kill a player.";
    case PresidentialPower.POLICY_PEEK:
      return "The president examines the top three cards.";
    default:
      return "Unknown";
  }
}

const PlayerList = ({ gameState, playerId, onSelect } : { gameState: GameState, playerId: Uuid, onSelect?: (id: Uuid) => void }) => {
  const numPlayers = Object.keys(gameState.players).length;

  // lobby player list
  if (gameState.turn_order.length <= 0) {
    return <>
      <b>Players <span style={{ color: numPlayers >= 5 && numPlayers <= 10 ? "green" : "red" }}>({numPlayers}/10)</span></b>
      <ul className="playerList">
        {Object.entries(gameState.players).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, data]) => <li key={id} className={playerId === id ? "self" : "other"}>{data.name} {id === gameState.host && " (Host)"}</li>)}
      </ul>
    </>;
  }

  const isSelectingChancellor = gameState.turn_phase.type === TurnPhase.ELECTING;
  const isVoting = gameState.turn_phase.type === TurnPhase.VOTING;

  const deadPlayers = Object.entries(gameState.players).filter(([id, data]) => data.dead).map(a => a[0]);

  const isUsingPower = gameState.turn_phase.type === TurnPhase.POWER && gameState.turn_phase.power !== PresidentialPower.POLICY_PEEK;

  return <>
    <b>Players ({(numPlayers - (gameState.num_facists ?? 0) - 1)} Liberals, {gameState.num_facists ?? 0} Facists, 1 Hitler)</b>
    <div className="playerList">
      {gameState.turn_order.concat(deadPlayers).map((id, idx) => {
        const playerData = gameState.players[id];
        const notAvailable = isSelectingChancellor && (gameState.last_chancellor === id || gameState.last_president === id || gameState.president === id);
        return <div key={id} className={`clearfix player ${playerId === id ? "self" : "other"}`}>
          <div className="order">[{playerData.dead ? "Dead" : idx + 1}]</div>
          {playerData.role != null ?
            <span className={`affiliation ${playerData.role.toLowerCase()}`}><img src={`/images/profiles/${playerData.role.toLowerCase()}.png`} /></span> : 
            <span className="affiliation"><div className="none">?</div></span>}
          <div className="name">{playerData.name}{playerId === id && " (You)"}</div>
          {gameState.president === id && <div className="role">President</div>}
          {gameState.chancellor === id && <div className="role">{isVoting && "Nominated "}Chancellor</div>}
          {playerData.vote != null && <div className="vote">Voted { gameState.players[id].vote ? "Yes": "No" }</div>}
          {(isSelectingChancellor || isUsingPower) && !playerData.dead && (
             gameState.president === playerId ? gameState.president === id || <button className="btn small" disabled={notAvailable} onClick={(e) => {
              e.preventDefault();
              onSelect && onSelect(id);
            }}>{isSelectingChancellor ?
                (gameState.last_chancellor === id ? "Previous Chancellor" : gameState.last_president === id ? "Previous President" : "Nominate as Chancellor") :
                getPowerDisplayName(gameState.turn_phase.power) }
            </button> : !notAvailable && <div className="eligible">Eligible</div>)}
        </div>;
      })}
    </div>
  </>
}

const PlayerVote = ({ gameState, onSelect, playerId }: { gameState: GameState, onSelect: (vote: boolean) => void, playerId: Uuid }) => {
  const remaining = gameState.turn_order.length - (gameState.votes ?? 0);
  const playerVote = gameState.players[playerId].vote;

  return <div className="voteBox">
    {gameState.chancellor != null && <div>Voting to elect <b>{gameState.players[gameState.chancellor].name}</b> as chancellor</div>}
    <p className="voteStatus"><b>{remaining}</b> voters remaining</p>
    {!gameState.players[playerId].dead && <><button className={playerVote === true ? "active" : undefined} onClick={(e) => {
      e.preventDefault();
      onSelect(true);
    }}>Ja!<span className="helpText">(Yes)</span></button>
    <button className={playerVote === false ? "active" : undefined} onClick={(e) => {
      e.preventDefault();
      onSelect(false);
    }}>Nien<span className="helpText">(No)</span></button></>}
  </div>
}

const CardSelect = ({ gameState, onSelect, onVeto } : { gameState: GameState, onSelect: (card: CardColor) => void, onVeto: () => void }) => {
  if (gameState.cards == null) {
    if (gameState.turn_phase.type === TurnPhase.PRESIDENT_SELECT && gameState.president != null) {
      return <div className="cardSelectBox"><p>President <b>{gameState.players[gameState.president].name}</b> is choosing a policy to discard</p></div>
    }
    else if (gameState.chancellor != null) {
      return <div className="cardSelectBox"><p>Chancellor <b>{gameState.players[gameState.chancellor].name}</b> is choosing a policy to enact</p></div>
    }
    return <div />
  }

  return <div className="cardSelectBox">
    <p>{gameState.turn_phase.type === TurnPhase.PRESIDENT_SELECT ? <>Choose the policy you would like to <b>discard</b></> : <>Choose the policy you would like to <b>enact</b></>}</p>
    {gameState.cards.map((card, i) => <button className={`policySlot ${card.toLowerCase()} active`} key={i} onClick={(e) => {
      e.preventDefault();
      onSelect(card);
    }}><img src={`/images/${card.toLowerCase()}.png`} alt={`${card} card`} /></button>)}
    {gameState.facist_policies >= 4 && <div className="vetoPowerBox">
      <p>If both the president and chancellor agree, both policies will be discarded and the president placard passes.</p>
      <p>Each use of the Veto Power represents an inactive government and advances the Election Tracker by one.</p>
      <button className="btn" onClick={(e) => {e.preventDefault(); onVeto();}}>Veto</button>
    </div>}
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
          {powers[idx] != null && <p>{getPowerDescription(powers[idx])}</p>}
          {idx >= 3 && <p>Facists win if Hitler is elected as Chancellor.</p>}
          {idx === 4 && <p>Veto power is unlocked.</p>}
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
  return <div className="policyPeek">
    <h3>Peek at the next 3 cards</h3>
    <div className="mb-1">
      {cards.map((card, idx) => <div key={idx} className={`${card.toLowerCase()} policySlot active`}><img src={`/images/${card.toLowerCase()}.png`} alt={`${card.toLowerCase()} card`} /></div>)}
    </div>
    <button className="btn" onClick={(e) => {
      e.preventDefault();
      onConfirm();
    }}>Confirm</button>
  </div>
};

const GameOver = ({ gameState }: { gameState: GameState }) => {
  let reason = "The game has ended.";
  const [hitlerId, hitlerPlayer] = Object.entries(gameState.players).find(plr => plr[1].role === "Hitler") ?? [null, null];

  useEffect(() => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: [gameState.turn_phase.winner === CardColor.FACIST ? "#ff0000" : "#0000ff"]
    });
  }, []);

  if (gameState.liberal_policies >= 5) {
    reason = "Liberals have enacted 5 policies.";
  }
  else if (gameState.facist_policies >= 6) {
    reason = "Facists have enacted 6 policies.";
  }
  else if (gameState.facist_policies > 3 && hitlerId == gameState.chancellor) {
    reason = "Hitler has been elected chancellor.";
  }
  else if (hitlerPlayer?.dead) {
    reason = "Hitler has been killed.";
  }

  return <div className="gameOverBox">
    <h1>Game Over! <span className={`affiliation ${gameState.turn_phase.winner?.toLowerCase()}`}>{gameState.turn_phase.winner}s</span> win!</h1>
    <p>{reason}</p>
  </div>;
}

const QuitButton = ({ gameState, playerId, onQuit }: { gameState: GameState, playerId: Uuid, onQuit: () => void }) => {
  const [isOpen, setOpen] = useState<boolean>(false);

  return <>
    {isOpen && <Draggable cancel=".btn"><div className="dialog">
        <h1>Quit Game</h1>
        <p><b>Are you sure you want to quit?</b> This game will not be able to continue without you!</p>
        <button className="btn" onClick={(e) => {
          e.preventDefault();
          setOpen(false);
          onQuit();
        }}>Quit Game</button>
      </div></Draggable>}
    <a href="#" onClick={(e) => {
      e.preventDefault();
      if (gameState.turn_phase.type === TurnPhase.LOBBY || gameState.turn_phase.type === TurnPhase.ENDED || gameState.players[playerId].dead) {
        onQuit();
      }
      else {
        setOpen((open) => !open);
      }
    }}>Quit</a>
  </>
};

const TipDialog = ({ role, onClose }: { role: "Hitler" | "Facist" | "Liberal" | null, onClose: () => void }) => {
  if (role == null) {
    return null;
  }
  return <Draggable cancel=".btn,img"><div className="tipDialog clearfix">
    <button className="btn small float-right" onClick={(e) => {
      e.preventDefault();
      onClose();
    }}>Close</button>
    <h1>Your role is <b className={`affiliation ${role.toLowerCase()}`}>{role}</b>!</h1>
    <div className="roleIcons">
      <div className={role === "Liberal" ? "active" : undefined}><img src="/images/profiles/liberal.png" alt="liberals" /><div>Liberals</div></div>
      <div className={role === "Facist" ? "active" : undefined}><img src="/images/profiles/facist.png" alt="facists" /><div>Facists</div></div>
      <div className={role === "Hitler" ? "active" : undefined}><img src="/images/profiles/hitler.png" alt="hitlers" /><div>Hitler</div></div>
    </div>
    {role === "Liberal" ?
      <div>
        <p>Players on the Liberal team win if either:</p>
        <ul>
          <li>Five Liberal Policies are enacted.</li>
          <li>Hitler is assassinated.</li>
        </ul>
      </div> :
      <div>
        <p>Players on the Fascist team win if either:</p>
        <ul>
          <li>Six Fascist Policies are enacted.</li>
          <li>Hitler is elected Chancellor any time after the third Fascist Policy has been enacted.</li>
        </ul>
        <p>Hitler plays for the Fascist team, and the Fascists know Hitler's identity from the outset, but Hitler doesn't know the Fascists and must work to figure them out.</p>
      </div>
    }
    <b>Strategy Notes for {role}s</b>
    <ul className="tips">
      {role === "Hitler" && <li><b>If this is your first time playing Hitler, just remember: be as Liberal as possible.</b> Enact Liberal Policies. Vote for Liberal governments. Kiss babies. Trust your fellow Fascists to create opportunities for you to enact Liberal Policies and to advance Fascism on their turns. The Fascists win by subtly manipulating the table and waiting for the right cover to enact Fascist Policies, not by overtly playing as evil.</li>}
      <li><b>Everyone should claim to be a Liberal.</b> Since the Liberal team has a voting majority, it can easily shut out any player claiming to be a Fascist. As a Fascist, there is no advantage to outing yourself to the majority. Additionally, Liberals should usually tell the truth. Liberals are trying to figure out the game like a puzzle, so lying can put their team at a significant disadvantage.</li>
      <li><b>Liberals frequently benefit from slowing play down and discussing the available information.</b> Fascists frequently benefit from rushing votes and creating confusion.</li>
      {role !== "Liberal" && <li><b>Fascists most often win by electing Hitler, not by enacting six Policies!</b> Electing Hitler isn't an optional or secondary win condition, it's the core of a successful Fascist strategy. Hitler should always play as a Liberal, and should generally avoid lying or getting into fights and disagreements with other players. When the time comes, Hitler needs the Liberals' trust to get elected. Even if Hitler isn't ultimately elected, the distrust sown among Liberals is key to getting Fascists elected late in the game.</li>}
      <li><b>Ask other players to explain why they took an action.</b> This is especially important with Presidential Powers - in fact, ask ahead of time whom a candidate is thinking of investigating/appointing/assassinating.</li>
      {role === "Liberal" && <li><b>If a Fascist Policy comes up, there are only three possible culprits: The President, the Chancellor, or the Policy Deck.</b> Try to figure out who (or what!) put you in this position.</li>}
    </ul>
  </div></Draggable>;
};

function getWindowGameId(): string | null {
  const match = window.location.pathname.match(/^\/game\/(.*?)(\/|$)/);
  if (match == null) {
    return null;
  }
  return match[1];
}

function Game({ nickname, gameId: initialGameId, suffix = "" }: GameProps) {
  const [alert, setAlert] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>({ players: {}, turn_phase: { type: TurnPhase.INTRO }, turn_order: [], liberal_policies: 0, facist_policies: 0 });
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  
  const [playerId, setPlayerId] = useState<Uuid | null>(localStorage.getItem(`playerId${suffix}`));
  const [playerSecret, setPlayerSecret] = useState<Uuid | null>(localStorage.getItem(`playerSecret${suffix}`));
  
  const windowGameId = getWindowGameId();
  const [gameId, setGameId] = useState<Uuid | null>(windowGameId ?? initialGameId ?? localStorage.getItem("gameId"));
  const [connected, setConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(gameId != null);
  const [showTips, setShowTips] = useState<boolean>(true);
  
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
  
  const reset = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current?.send(JSON.stringify({ type: "Leave" }));
    }
    setPlayerId(null);
    setGameId(null);
    setChatLines([]);
    setAlert(null);
    localStorage.removeItem("gameId");
    localStorage.removeItem(`playerId${suffix}`);
    localStorage.removeItem(`playerSecret${suffix}`);
    setGameState((state) => ({ ...state, turn_phase: { type: TurnPhase.INTRO } }));
  };

  const connect = () => {
    ws.current = new WebSocket(`${window.location.protocol.replace('http', 'ws')}//${window.location.hostname === "localhost" ? "localhost:8000" : window.location.host}/ws/`);
    ws.current.onopen = () => {
      setConnected(true);
      const finalPlayerId = playerId ?? localStorage.getItem(`playerId${suffix}`);
      const nickname = localStorage.getItem(`nickname${suffix}`);
      const finalPlayerSecret = playerSecret ?? localStorage.getItem(`playerSecret${suffix}`);
      if (finalPlayerId != null && nickname != null && finalPlayerSecret != null) {
        ws.current?.send(JSON.stringify({type: "JoinGame", "nickname": nickname, "id": gameId, "player_id": finalPlayerId, "player_secret": finalPlayerSecret}));
        ws.current?.send(JSON.stringify({ type: "GetChatLog" }));
      }
      else {
        setLoading(false);
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
          setLoading(false);
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
          setLoading(false);
          break;
        case "GameState":
          setGameState(packet.state);
          break;
      }
    };
  }

  useEffect(connect, []);

  if (loading) {
    return <div className="content">
      <div className="welcome">
        <h1>Secret Hitler</h1>
        {connected ? <p>Reconnecting to previous game...</p> : <p>Connecting to server...</p>}
      </div>
    </div>;
  }

  if (gameState.turn_phase.type === TurnPhase.INTRO || playerId == null) {
    return <div className="content">
      <div className="welcome">
        <h1>Secret Hitler</h1>
        <p>A social deduction game for 5-10 people</p>
        <IntroPrompt suffix={suffix} nickname={nickname} gameId={gameId} alert={alert} clickedLink={!!windowGameId} onSubmit={(nick, game) => {
          localStorage.setItem(`nickname${suffix}`, nick);
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current?.send(JSON.stringify({ "type": game != null ? "JoinGame" : "HostGame", "nickname": nick, "id": game }));
            setAlert(null);
          }
          else {
            setAlert("The websocket connection has not been established yet.");
          }
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
          onReset={reset} /> : <div>
        <PlayerList gameState={gameState} playerId={playerId} onSelect={(id) => {
          if (gameState.turn_phase.type === TurnPhase.ELECTING) {
            ws.current?.send(JSON.stringify({ "type": "ChooseChancellor", "player": id }));
          }
          if (gameState.turn_phase.type === TurnPhase.POWER) {
            ws.current?.send(JSON.stringify({ "type": "PresidentialPower", "player": id }));
          }
        }} />
        <p style={{textAlign: "center"}}>There are <b>{gameState.cards_in_deck ?? 0}</b> cards in the draw pile and <b>{gameState.cards_in_discard ?? 0}</b> cards in the discard pile</p>
        <ElectionTracker num={gameState.election_tracker} />
        <CardTable gameState={gameState} />
        {gameState.turn_phase.type === TurnPhase.VOTING && <PlayerVote gameState={gameState} playerId={playerId} onSelect={(vote) => {
          ws.current?.send(JSON.stringify({ "type": "VoteChancellor", vote: vote }));
        }} />}
        {(gameState.turn_phase.type === TurnPhase.PRESIDENT_SELECT || gameState.turn_phase.type === TurnPhase.CHANCELLOR_SELECT) && <CardSelect gameState={gameState} onSelect={(card) => {
          ws.current?.send(JSON.stringify({ "type": "PickCard", color: card === CardColor.FACIST }));
        }} onVeto={() => {
          ws.current?.send(JSON.stringify({ "type": "VetoCard" }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.POWER && gameState.turn_phase.power === PresidentialPower.POLICY_PEEK && playerId === gameState.president && <PolicyPeek cards={gameState.cards ?? []} onConfirm={() => {
          ws.current?.send(JSON.stringify({ "type": "PresidentialPower" }));
        }} />}
        {gameState.turn_phase.type === TurnPhase.ENDED && <GameOver gameState={gameState} />}
        {gameState.turn_phase.type === TurnPhase.ELECTING && gameState.president != null && <div className="infoBox">President <b>{gameState.players[gameState.president].name}</b> is electing a chancellor</div>}
        {showTips && <TipDialog onClose={() => setShowTips(false)} role={gameState.players[playerId]?.role ?? null} />}
      </div>}
    </div>
    <ChatBox playerId={playerId} gameState={gameState} lines={chatLines} onSubmit={(line) => ws.current?.send(JSON.stringify({type: "SendChat", message: line}))} />
    <div className="footer">
      <a href="https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf" target="_blank" rel="noopener noreferrer">Rules</a> - <a href="#" onClick={(e) => {e.preventDefault(); setShowTips(tips => !tips)}}>Tips</a> - <QuitButton gameState={gameState} playerId={playerId} onQuit={reset} />
     {!connected && <> - <span className="disconnected">Disconnected</span></>}</div>
  </div>;
}

export default App;
