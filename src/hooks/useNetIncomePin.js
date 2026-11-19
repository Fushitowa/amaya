import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../utils/api.js";

export function useNetIncomePin() {
  const [token, setToken] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const timerRef = useRef(null);
  const unlocked = Boolean(token);

  useEffect(() => {
    let active = true;
    apiRequest("/finances/net-income-pin/status")
      .then((status) => { if (active) setHasPin(Boolean(status.hasPin)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const lock = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setToken("");
  }, []);

  const unlock = useCallback((accessToken, pinExists = true) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setToken(accessToken);
    setHasPin(pinExists);
    timerRef.current = window.setTimeout(() => setToken(""), 15 * 60 * 1000);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const financialHeaders = useMemo(() => (token ? { "X-Net-Income-Token": token } : {}), [token]);
  return { token, hasPin, unlocked, modalOpen, setModalOpen, lock, unlock, financialHeaders };
}
