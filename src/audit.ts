import { getAuditStore, setAuditStore, FileAuditStore, AuditEntry, AuditStore } from "./persistence/audit";

export type { AuditEntry, AuditStore } from "./persistence/audit";
export { getAuditStore, setAuditStore } from "./persistence/audit";

export function setAuditDataDir(dir: string): void {
  const store = new FileAuditStore(dir);
  setAuditStore(store);
}

export function appendAuditLog(entry: AuditEntry): void {
  getAuditStore().append(entry).catch((err) => {
    console.error("[audit] failed to append audit entry:", err);
  });
}

export async function readAuditLog(filters?: {
  taskId?: string;
  agentId?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  return getAuditStore().read(filters);
}
