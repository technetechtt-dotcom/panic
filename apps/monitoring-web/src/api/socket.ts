import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { refreshSession } from "./client";

export function useMonitorSocket(token: string | null, onEvent: (name: string) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const currentToken = useRef(token);
  currentToken.current = token;

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io("/monitoring", { autoConnect: true, withCredentials: true });
    const refresh = (name: string) => handler.current(name);
    const authorize = (next: string) => socket.emit("auth", { token: next });
    socket.on("connect", () => authorize(currentToken.current ?? token));
    socket.on("auth.error", () => {
      void refreshSession().then((next) => {
        if (next) authorize(next);
        else socket.close();
      });
    });
    socket.on("incident.created", () => refresh("incident.created"));
    socket.on("incident.updated", () => refresh("incident.updated"));
    socket.on("incident.acknowledged", () => refresh("incident.acknowledged"));
    socket.on("incident.resolved", () => refresh("incident.resolved"));
    socket.on("location.updated", () => refresh("location.updated"));
    socket.on("heartbeat.updated", () => refresh("heartbeat.updated"));
    socket.on("device.offline", () => refresh("device.offline"));
    socket.on("duress.detected", () => refresh("duress.detected"));
    socket.on("evidence.received", () => refresh("evidence.received"));
    socket.on("risk.updated", () => refresh("risk.updated"));
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
