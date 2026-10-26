let websocket = "socket.io process attached";


export function setWebsocketStatus(value: string): void {
  websocket = value;
}

export function websocketStatus(): string {
  return websocket;
}
