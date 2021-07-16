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
  reconnect?: boolean,
  nickname?: string,
  gameId?: string
}

enum TurnPhase {
  INTRO = "Intro",
  LOBBY = "Lobby"
}

type Uuid = string;
type GameState = { players: {[key: string]: {name: string}}, turn_phase: TurnPhase, [key: string]: any, host?: Uuid, president?: Uuid, turn_order: Uuid[] };

const PlayerList = ({ gameState } : { gameState: GameState }) => {
  return <>
    <b>Players</b>
    <ul>
      {gameState.turn_order.length <= 0 ? Object.entries(gameState.players).map(([id, data]) => <li key={id}>{data.name} {id === gameState.host && " (Host)"}</li>) : gameState.turn_order.map(id => {
        const name = gameState.players[id].name;
        return <li key={id}>{name} {gameState.president === id && " (President)"}</li>;
      })}
    </ul>
  </>
}

function Game({ reconnect, nickname, gameId: initialGameId }: GameProps) {
  const [alert, setAlert] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>({ players: {}, turn_phase: TurnPhase.INTRO, turn_order: [] });
  const [chatLines, setChatLines] = useState<{ name: string, message: string }[]>([]);
  const [playerId, setPlayerId] = useState<Uuid | null>(localStorage.getItem("playerId"));
  const [gameId, setGameId] = useState<Uuid | null>(initialGameId ?? localStorage.getItem("gameId"));
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
    ws.current = new WebSocket("ws://localhost:8000/ws/");
    ws.current.onopen = () => {
      if (reconnect) {
        const playerId = localStorage.getItem("playerId");
        const nickname = localStorage.getItem("nickname");
        const playerSecret = localStorage.getItem("playerSecret");
        if (playerId != null) {
          ws.current?.send(JSON.stringify({type: "JoinGame", "nickname": nickname, "id": gameId, "player_id": playerId, "player_secret": playerSecret}));
        }
      }
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
          localStorage.setItem("playerSecret", packet.secret);
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
  }, []);

  if (gameState.turn_phase === TurnPhase.INTRO) {
    return <div className="content">
        <div className="welcome">
        <IntroPrompt nickname={nickname} alert={alert} onSubmit={(nick, game) => {
        localStorage.setItem("nickname", nick);
        ws.current?.send(JSON.stringify({"type": game != null ? "JoinGame" : "HostGame", "nickname": nick, "id": game}));
      }} />
      </div>
    </div>;
  }

  return <div className="content">
    <div className="game">
      {alert != null && <div className="alert">{alert}</div>}
      {gameState.turn_phase === TurnPhase.LOBBY ? <div>
        <b>Join Code: </b> {gameId}<br />
        <PlayerList gameState={gameState} />
        <button disabled={playerId !== gameState.host} onClick={() => ws.current?.send(JSON.stringify({ type: "StartGame" }))}>Start Game</button>
      </div> : <div>
        <PlayerList gameState={gameState} />
      </div>}
    </div>
    <ChatBox lines={chatLines} onSubmit={(line) => ws.current?.send(JSON.stringify({type: "SendChat", message: line}))} />
  </div>;
}

export default App;
