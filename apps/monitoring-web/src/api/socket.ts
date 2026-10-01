import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

export function useMonitorSocket(token: string | null, onEvent: () => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io("/monitoring", { autoConnect: true, withCredentials: true });
    const refresh = () => handler.current();
    socket.on("connect", () => socket.emit("auth", { token }));
    socket.on("incident.created", refresh);
    socket.on("incident.acknowledged", refresh);
    socket.on("incident.resolved", refresh);
    socket.on("location.updated", refresh);
    socket.on("heartbeat.updated", refresh);
    socket.on("device.offline", refresh);
    return () => {
      socket.close();
    };
  }, [token]);
}
