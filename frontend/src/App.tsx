import { useRef } from 'react';
import { useState, useEffect, ReactElement } from 'react';
import './App.css';

enum GameState {
  INTRO,
  LOBBY,
  GAME
}

const ChatBox = ({ lines, onSubmit }: { lines: {name: string, message: string}[], onSubmit: (line: string) => void }): ReactElement => {
  const [line, setLine] = useState<string>("");

  return <div>
    <div>{lines.map((l, i) => <div key={i}><b>{l.name}</b> {l.message}</div>)}</div>
    <input value={line} onChange={e => setLine(e.target.value)} onKeyDown={e => {
      if (e.key === "Enter")
      {
        onSubmit(line);
        setLine("");
      }
    }} />
  </div>
}

const IntroPrompt = ({ alert, onSubmit }: { alert: string | null, onSubmit: (name: string, game: string | null) => void }): ReactElement => {
  const [nickname, setNickname] = useState<string>(localStorage.getItem("nickname") || "");
  const [gameCode, setGameCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert != error) {
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
  const [state, setState] = useState<GameState>(GameState.INTRO);
  const [alert, setAlert] = useState<string | null>(null);
  const [playerList, setPlayerList] = useState<{id: string, name: string}[]>([]);
  const [chatLines, setChatLines] = useState<{ name: string, message: string }[]>([]);
  const ws = useRef<WebSocket | null>(null);

  const chatBox = <ChatBox lines={chatLines} onSubmit={(line) => ws.current?.send(JSON.stringify({type: "SendChat", message: line}))} />

  useEffect(() => {
    ws.current = new WebSocket("ws://localhost:8000/ws/");
    ws.current.onopen = () => {
      const playerId = localStorage.getItem("playerId");
      const gameId = localStorage.getItem("gameId");
      const nickname = localStorage.getItem("nickname");
      const playerSecret = localStorage.getItem("playerSecret");
      if (playerId != null) {
        ws.current?.send(JSON.stringify({type: "JoinGame", "nickname": nickname, "id": gameId, "player_id": playerId, "player_secret": playerSecret}));
      }
    };
    ws.current.onmessage = (msg) => {
      const packet = JSON.parse(msg.data);
      switch (packet.type) {
        case "Alert":
          setAlert(packet.message);
          break;
        case "PlayerList":
          setState(GameState.LOBBY);
          setPlayerList(packet.players);
          break;
        case "SetIdentifiers":
          localStorage.setItem("playerId", packet.player_id);
          localStorage.setItem("gameId", packet.game_id);
          localStorage.setItem("playerSecret", packet.secret);
          break;
        case "ReceiveChat":
          setChatLines(l => [...l, packet]);
          break;
      }
    };
  }, []);

  if (state == GameState.INTRO) {
    return <IntroPrompt alert={alert} onSubmit={(nick, game) => {
      localStorage.setItem("nickname", nick);
      ws.current?.send(JSON.stringify({"type": game != null ? "JoinGame" : "HostGame", "nickname": nick, "id": game}));
    }} />;
  }

  if (state == GameState.LOBBY) {
    return <div>
      {alert != null && <div className="alert">{alert}</div>}
      <b>Players</b>
      <ul>
        {playerList.map(player => <li key={player.id}>{player.name}</li>)}
      </ul>
      <button onClick={() => ws.current?.send(JSON.stringify({ type: "StartGame" }))}>Start Game</button>
      {chatBox}
    </div>;
  }

  return <div className="content"></div>;
}

export default App;
