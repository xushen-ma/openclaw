export const MATRIX_FLEET_MGMT_PROBE_ROOM_ID = "!bSZooEPKekiUuHRikF:home.jxs.com.au";

export function isMatrixFleetMgmtProbeRoom(roomId: string | null | undefined): roomId is string {
  return roomId === MATRIX_FLEET_MGMT_PROBE_ROOM_ID;
}

export function logMatrixFleetMgmtProbe(
  log: (message: string) => void,
  params: {
    stage: string;
    roomId: string | null | undefined;
    accountId?: string | null;
    userId?: string | null;
    eventName?: string | null;
    eventType?: string | null;
    eventId?: string | null;
    listeners?: string | null;
    detail?: string | null;
  },
): void {
  if (!isMatrixFleetMgmtProbeRoom(params.roomId)) {
    return;
  }
  const fields = [
    `stage=${params.stage}`,
    params.accountId ? `account=${params.accountId}` : null,
    params.userId ? `user=${params.userId}` : null,
    params.eventName ? `event=${params.eventName}` : null,
    `room=${params.roomId}`,
    params.eventType ? `type=${params.eventType}` : null,
    params.eventId ? `id=${params.eventId}` : null,
    params.listeners ? `listeners=${params.listeners}` : null,
    params.detail ? `detail=${params.detail}` : null,
  ].filter(Boolean);
  log(`matrix-probe: ${fields.join(" ")}`);
}
