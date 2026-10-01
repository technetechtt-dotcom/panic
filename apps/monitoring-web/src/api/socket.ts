import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { refreshSession } from "./client";

export function useMonitorSocket(token: string | null, onEvent: () => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const currentToken = useRef(token);
  currentToken.current = token;

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io("/monitoring", { autoConnect: true, withCredentials: true });
    const refresh = () => handler.current();
    const authorize = (next: string) => socket.emit("auth", { token: next });
    socket.on("connect", () => authorize(currentToken.current ?? token));
    socket.on("auth.error", () => {
      void refreshSession().then((next) => {
        if (next) authorize(next);
        else socket.close();
      });
    });
    socket.on("incident.created", refresh);
    socket.on("incident.updated", refresh);
    socket.on("incident.acknowledged", refresh);
    socket.on("incident.resolved", refresh);
    socket.on("location.updated", refresh);
    socket.on("heartbeat.updated", refresh);
    socket.on("device.offline", refresh);
    socket.on("duress.detected", refresh);
    socket.on("evidence.received", refresh);
    socket.on("risk.updated", refresh);
    const timer = window.setInterval(() => {
      void refreshSession().then((next) => {
        if (next && socket.connected) authorize(next);
      });
    }, 10 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      socket.close();
    };
  }, [token]);
}
